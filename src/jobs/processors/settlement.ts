import { db } from "@/db/knex";
import { logger } from "@/common/utils/logger";
import { dispatchNotification } from "../dispatch";

export interface SettlementResult {
  settled: boolean;
  reason?: "not_found" | "not_completed" | "no_driver" | "already_settled";
  netEarning?: number;
  commission?: number;
}

/**
 * Credits a completed trip's driver earnings. Idempotent and safe to call any number of times, from any
 * number of processes (BullMQ worker, inline fallback, reconcile sweep):
 *   1. `UPDATE trips SET settled_at = now() WHERE id = ? AND settled_at IS NULL` claims the trip atomically
 *      inside the same DB transaction as the wallet credit; exactly one caller gets a row back.
 *   2. A partial unique index on transactions(trip_id) WHERE type = 'fare_payment' is a second guard, so
 *      even a bug in (1) cannot produce a duplicate credit — the whole transaction would roll back.
 */
export async function settleTrip(tripId: string): Promise<SettlementResult> {
  const trip = await db("trips").where({ id: tripId }).first();
  if (!trip) return { settled: false, reason: "not_found" };
  if (trip.status !== "completed") return { settled: false, reason: "not_completed" };
  if (!trip.driver_id) return { settled: false, reason: "no_driver" };
  if (trip.settled_at) return { settled: false, reason: "already_settled" };

  const profile = await db("driver_profiles").where({ user_id: trip.driver_id }).first();
  const feePct = Number(profile?.service_fee_pct ?? 15);
  const fare = Number(trip.fare);
  const commission = Math.round(fare * (feePct / 100));
  const netEarning = fare - commission;

  const claimed = await db.transaction(async (trx) => {
    const [claim] = await trx("trips")
      .where({ id: tripId })
      .whereNull("settled_at")
      .update({ settled_at: trx.fn.now(), driver_earning: netEarning, platform_fee: commission })
      .returning("id");
    if (!claim) return false;

    let wallet = await trx("wallets").where({ user_id: trip.driver_id }).first();
    if (!wallet) [wallet] = await trx("wallets").insert({ user_id: trip.driver_id, balance: 0 }).returning("*");

    await trx("wallets").where({ id: wallet.id }).increment("balance", netEarning);
    await trx("transactions").insert({
      wallet_id: wallet.id,
      user_id: trip.driver_id,
      type: "fare_payment",
      amount: netEarning,
      status: "successful",
      provider: "internal",
      trip_id: trip.id,
      metadata: JSON.stringify({ fare, commission, feePct }),
    });
    await trx("driver_profiles")
      .where({ user_id: trip.driver_id })
      .increment("total_trips", 1)
      .increment("total_earned", netEarning);
    return true;
  });

  if (!claimed) return { settled: false, reason: "already_settled" };

  await dispatchNotification({
    userId: trip.driver_id,
    title: "Trip earnings added",
    body: `₦${(netEarning / 100).toLocaleString()} was added to your wallet for your last trip.`,
    kind: "money",
  });
  return { settled: true, netEarning, commission };
}

/** Sweep for completed trips whose settlement never ran (Redis outage, crash between complete and enqueue). */
export async function reconcileUnsettledTrips(limit = 100): Promise<number> {
  const rows = await db("trips")
    .where({ status: "completed" })
    .whereNull("settled_at")
    .whereNotNull("driver_id")
    .orderBy("completed_at", "asc")
    .limit(limit)
    .select("id");
  let settled = 0;
  for (const r of rows) {
    try {
      const res = await settleTrip(r.id);
      if (res.settled) settled++;
    } catch (err) {
      logger.error({ err, tripId: r.id }, "reconcile: settlement failed");
    }
  }
  if (settled) logger.info({ settled }, "reconcile: settled previously-unsettled trips");
  return settled;
}
