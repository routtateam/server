import { beforeAll, describe, expect, it } from "vitest";
import { api, auth, makeTrip, P, personas } from "./helpers";
import { db } from "@/db/knex";
import { settleTrip, reconcileUnsettledTrips } from "@/jobs/processors/settlement";
import { processCalculateTripSettlement } from "@/jobs/processors/payout.processor";

let p: Awaited<ReturnType<typeof personas>>;
beforeAll(async () => {
  p = await personas();
});

const wallet = async () => Number((await db("wallets").where({ user_id: p.driver.id }).first()).balance);
const credits = (tripId: string) => db("transactions").where({ trip_id: tripId, type: "fare_payment" });

describe("POST /trips/:id/complete credits driver earnings exactly once", () => {
  it("credits the wallet (85% of fare) and records one ledger row, with JOBS_MODE=inline (no Redis)", async () => {
    const trip = await makeTrip(p, "in_progress", 200000);
    const before = await wallet();
    const res = await api().post(`${P}/trips/${trip.id}/complete`).set(auth(p.driverToken));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("completed");

    expect(await wallet()).toBe(before + 170000);
    const rows = await credits(trip.id);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].amount)).toBe(170000);
    const after = await db("trips").where({ id: trip.id }).first();
    expect(after.settled_at).not.toBeNull();
    expect(Number(after.driver_earning)).toBe(170000);
    expect(Number(after.platform_fee)).toBe(30000);
  });

  it("is idempotent: completing again, the worker job running too, and concurrent runs never double-credit", async () => {
    const trip = await makeTrip(p, "in_progress", 100000);
    const before = await wallet();
    const profileBefore = await db("driver_profiles").where({ user_id: p.driver.id }).first();

    await api().post(`${P}/trips/${trip.id}/complete`).set(auth(p.driverToken)).expect(200);
    await api().post(`${P}/trips/${trip.id}/complete`).set(auth(p.driverToken)).expect(200); // client retry
    await processCalculateTripSettlement({ data: { tripId: trip.id } } as any); // BullMQ worker also runs the job
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => settleTrip(trip.id))); // concurrent duplicates
    expect(results.every((r) => r.settled === false)).toBe(true);
    await reconcileUnsettledTrips();

    expect(await wallet()).toBe(before + 85000);
    expect(await credits(trip.id)).toHaveLength(1);
    const profileAfter = await db("driver_profiles").where({ user_id: p.driver.id }).first();
    expect(profileAfter.total_trips).toBe(profileBefore.total_trips + 1);
    expect(Number(profileAfter.total_earned)).toBe(Number(profileBefore.total_earned) + 85000);
  });

  it("racing the first settlement: exactly one of N concurrent settleTrip calls wins", async () => {
    const trip = await makeTrip(p, "in_progress", 300000);
    await db("trips").where({ id: trip.id }).update({ status: "completed", completed_at: db.fn.now() }); // completed, not yet settled
    const before = await wallet();
    const results = await Promise.all(Array.from({ length: 8 }, () => settleTrip(trip.id).catch((error) => ({ settled: false, error }))));
    expect(results.filter((r) => r.settled).length).toBe(1);
    expect(await wallet()).toBe(before + 255000);
    expect(await credits(trip.id)).toHaveLength(1);
  });

  it("reconcile sweep settles a completed-but-unsettled trip (e.g. after a Redis outage)", async () => {
    const trip = await makeTrip(p, "in_progress", 50000);
    await db("trips").where({ id: trip.id }).update({ status: "completed", completed_at: db.fn.now() });
    const before = await wallet();
    await reconcileUnsettledTrips();
    expect(await wallet()).toBe(before + 42500);
  });

  it("does not settle trips that are not completed, and cancelled trips cannot be completed", async () => {
    const trip = await makeTrip(p, "accepted");
    expect((await settleTrip(trip.id)).reason).toBe("not_completed");
    await db("trips").where({ id: trip.id }).update({ status: "cancelled" });
    const res = await api().post(`${P}/trips/${trip.id}/complete`).set(auth(p.driverToken));
    expect(res.status).toBe(422);
  });

  it("the database itself refuses a second fare_payment for the same trip (unique index)", async () => {
    const trip = await makeTrip(p, "in_progress", 100000);
    await api().post(`${P}/trips/${trip.id}/complete`).set(auth(p.driverToken)).expect(200);
    const w = await db("wallets").where({ user_id: p.driver.id }).first();
    await expect(
      db("transactions").insert({ wallet_id: w.id, user_id: p.driver.id, type: "fare_payment", amount: 1, status: "successful", trip_id: trip.id })
    ).rejects.toThrow();
  });
});
