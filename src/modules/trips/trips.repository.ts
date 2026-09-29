import { db } from "@/db/knex";
import { startOfLocalDay } from "@/common/utils/time";

export const tripsRepository = {
  listPricingRules() {
    return db("pricing_rules").select("*");
  },

  create(input: Record<string, unknown>) {
    return db("trips").insert(input).returning("*");
  },

  findById(id: string) {
    return db("trips").where({ id }).first();
  },

  update(id: string, patch: Record<string, unknown>) {
    return db("trips").where({ id }).update({ ...patch, updated_at: db.fn.now() }).returning("*");
  },

  async findMatchCandidateDriver(category: string, tripId?: string) {
    return db("driver_profiles as dp")
      .join("vehicles as v", function join() {
        this.on("v.driver_id", "=", "dp.user_id").andOn("v.category", "=", db.raw("?", [category]));
      })
      .join("users as u", "u.id", "dp.user_id")
      .where("dp.online", true)
      .andWhere("u.status", "active")
      .whereNotExists(function sub() {
        this.select("id").from("trips").whereRaw('trips.driver_id = dp.user_id').whereIn("trips.status", [
          "accepted",
          "enroute",
          "arrived",
          "in_progress",
        ]);
      })
      .modify((qb) => {
        if (tripId) qb.whereNotExists(function declined() {
          this.select("id").from("trip_declines").whereRaw("trip_declines.driver_id = dp.user_id").andWhere("trip_declines.trip_id", tripId);
        });
      })
      .select("dp.user_id as driver_id", "v.id as vehicle_id")
      .first();
  },

  listIncomingForDriver(category: string, driverId: string) {
    return db("trips")
      .where({ status: "matching", category })
      .whereNull("driver_id")
      .andWhereNot("commuter_id", driverId)
      .whereNotExists(function declined() {
        this.select("id").from("trip_declines").whereRaw("trip_declines.trip_id = trips.id").andWhere("trip_declines.driver_id", driverId);
      })
      .orderBy("created_at", "asc")
      .limit(5);
  },

  historyForCommuter(commuterId: string, offset: number, limit: number) {
    return db("trips")
      .where({ commuter_id: commuterId })
      .whereIn("status", ["completed", "cancelled"])
      .orderBy("created_at", "desc")
      .offset(offset)
      .limit(limit);
  },

  countHistoryForCommuter(commuterId: string) {
    return db("trips")
      .where({ commuter_id: commuterId })
      .whereIn("status", ["completed", "cancelled"])
      .count<{ count: string }[]>("id as count")
      .first();
  },

  todayForDriver(driverId: string) {
    const startOfDay = startOfLocalDay();
    return db("trips")
      .where({ driver_id: driverId })
      .whereIn("status", ["completed", "cancelled"])
      .andWhere("created_at", ">=", startOfDay)
      .orderBy("created_at", "desc");
  },

  driverInfoForTrip: (driverId: string) =>
    db("users as u").join("driver_profiles as dp", "dp.user_id", "u.id").where("u.id", driverId).first(),

  vehicleForDriver: (driverId: string) => db("vehicles").where({ driver_id: driverId, is_active: true }).first(),
};

export const tripsExtraRepository = {
  commuterSummary(commuterId: string) {
    return db("users as u")
      .where("u.id", commuterId)
      .select("u.first_name", "u.last_name", "u.rating")
      .select(db.raw("(select count(*) from trips t where t.commuter_id = u.id and t.status = 'completed') as trips"))
      .first();
  },

  paymentMethod(id: string) {
    return db("payment_methods").where({ id }).first();
  },

  driverProfile(driverId: string) {
    return db("driver_profiles").where({ user_id: driverId }).first();
  },

  /** Atomic claim: only one caller can move a trip from "matching" to "accepted". */
  async claimForDriver(tripId: string, driverId: string, vehicleId?: string | null) {
    const [row] = await db("trips")
      .where({ id: tripId, status: "matching" })
      .whereNull("driver_id")
      .update({ driver_id: driverId, vehicle_id: vehicleId ?? null, status: "accepted", accepted_at: db.fn.now(), updated_at: db.fn.now() })
      .returning("*");
    return row;
  },

  /** Persists a decline (idempotent) and, only on first insert, updates the driver's offer counters. */
  async recordDecline(tripId: string, driverId: string, reason?: string): Promise<number> {
    return db.transaction(async (trx) => {
      const inserted = await trx("trip_declines").insert({ trip_id: tripId, driver_id: driverId, reason }).onConflict(["trip_id", "driver_id"]).ignore().returning("id");
      if (inserted.length) await trx("driver_profiles").where({ user_id: driverId }).increment("offers_declined", 1);
      return recomputeAcceptance(trx, driverId);
    });
  },

  async recordAccepted(driverId: string): Promise<number> {
    return db.transaction(async (trx) => {
      await trx("driver_profiles").where({ user_id: driverId }).increment("offers_accepted", 1);
      return recomputeAcceptance(trx, driverId);
    });
  },

  async releaseToMatching(tripId: string, driverId: string) {
    const [row] = await db("trips")
      .where({ id: tripId, driver_id: driverId })
      .whereIn("status", ["accepted"])
      .update({ driver_id: null, vehicle_id: null, status: "matching", accepted_at: null, updated_at: db.fn.now() })
      .returning("*");
    return row;
  },

  bumpPinAttempts(tripId: string) {
    return db("trips").where({ id: tripId }).increment("pin_attempts", 1).returning("pin_attempts");
  },
};

/** acceptance_rate = accepted / (accepted + declined) * 100; 100 while there is no history. */
async function recomputeAcceptance(trx: any, driverId: string): Promise<number> {
  const p = await trx("driver_profiles").where({ user_id: driverId }).first();
  const total = Number(p?.offers_accepted ?? 0) + Number(p?.offers_declined ?? 0);
  const rate = total ? Math.round((Number(p.offers_accepted) / total) * 10000) / 100 : 100;
  await trx("driver_profiles").where({ user_id: driverId }).update({ acceptance_rate: rate });
  return Math.round(rate);
}
