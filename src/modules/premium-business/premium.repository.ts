import { db } from "@/db/knex";
import type { Knex } from "knex";

export const premiumRepository = {
  listLiveVehicles() {
    return db("premium_vehicles").where({ status: "live" }).orderBy("created_at", "desc");
  },

  findVehicle(id: string) {
    return db("premium_vehicles").where({ id }).first();
  },

  findVehicleForBusiness(businessId: string, id: string) {
    return db("premium_vehicles").where({ id, business_id: businessId }).first();
  },

  tiersForVehicle(vehicleId: string) {
    return db("premium_tiers").where({ vehicle_id: vehicleId }).orderBy("price", "asc");
  },

  findTier(id: string) {
    return db("premium_tiers").where({ id }).first();
  },

  findBusiness(id: string) {
    return db("businesses").where({ id }).first();
  },

  createBooking(input: Record<string, unknown>, trx?: Knex.Transaction) {
    return (trx ?? db)("premium_bookings").insert(input).returning("*");
  },

  bookingsForCommuter(commuterId: string) {
    return db("premium_bookings").where({ commuter_id: commuterId }).orderBy("created_at", "desc");
  },

  latestActiveBookingForCommuter(commuterId: string) {
    return db("premium_bookings")
      .where({ commuter_id: commuterId })
      .whereIn("status", ["requested", "confirmed", "active"])
      .orderBy("created_at", "desc")
      .first();
  },

  // --- Business partner side ---

  vehiclesForBusiness(businessId: string) {
    return db("premium_vehicles").where({ business_id: businessId }).orderBy("created_at", "desc");
  },

  createVehicle(businessId: string, input: Record<string, unknown>) {
    return db("premium_vehicles").insert({ business_id: businessId, ...input }).returning("*");
  },

  updateVehicle(businessId: string, id: string, patch: Record<string, unknown>) {
    return db("premium_vehicles").where({ business_id: businessId, id }).update({ ...patch, updated_at: db.fn.now() }).returning("*");
  },

  createTiers(vehicleId: string, tiers: Array<{ label: string; sub?: string; price: number }>) {
    return db("premium_tiers").insert(tiers.map((t) => ({ vehicle_id: vehicleId, label: t.label, sub: t.sub, price: t.price })));
  },

  bookingsForBusiness(businessId: string, statuses?: string[]) {
    const q = db("premium_bookings").where({ business_id: businessId }).orderBy("created_at", "desc");
    if (statuses?.length) q.whereIn("status", statuses);
    return q;
  },

  teamForBusiness(businessId: string) {
    return db("business_team_members").where({ business_id: businessId }).orderBy("created_at", "asc");
  },

  inviteTeamMember(businessId: string, email: string, role: string) {
    return db("business_team_members").insert({ business_id: businessId, invited_email: email, role, status: "invited" }).returning("*");
  },

  businessForUser(userId: string) {
    return db("business_team_members as btm")
      .join("businesses as b", "b.id", "btm.business_id")
      .where("btm.user_id", userId)
      .andWhere("btm.status", "active")
      .select("b.*", "btm.role as member_role")
      .first();
  },
};

/** Partner booking workflow: requests, timeline, inspection, deposits, availability, earnings. */
export const partnerRepository = {
  /** Marks requested bookings whose respond_by has passed as expired (and logs the timeline event). */
  async expireStaleRequests(): Promise<number> {
    const rows = await db("premium_bookings")
      .where({ status: "requested" })
      .andWhere("respond_by", "<", db.fn.now())
      .update({ status: "expired", updated_at: db.fn.now() })
      .returning("id");
    if (rows.length) {
      await db("booking_events").insert(
        rows.map((r: any) => ({ booking_id: r.id, kind: "expired", title: "Request expired", subtitle: "No response before the deadline" }))
      );
    }
    return rows.length;
  },

  findBookingForBusiness(businessId: string, id: string) {
    return db("premium_bookings").where({ id, business_id: businessId }).first();
  },

  /** Resolves a full uuid or the short display reference (PR-1A2B3C = first 6 hex chars) within one business. */
  async resolveBookingId(businessId: string, idOrRef: string): Promise<{ id?: string; ambiguous?: boolean }> {
    if (/^[0-9a-f-]{36}$/i.test(idOrRef)) {
      const row = await db("premium_bookings").where({ id: idOrRef.toLowerCase(), business_id: businessId }).first("id");
      return { id: row?.id };
    }
    const m = /^PR-([0-9A-F]{6})$/i.exec(idOrRef);
    if (!m) return {};
    const rows = await db("premium_bookings")
      .where({ business_id: businessId })
      .whereRaw("replace(id::text, '-', '') ilike ?", [`${m[1]}%`])
      .limit(2)
      .select("id");
    if (rows.length > 1) return { ambiguous: true };
    return { id: rows[0]?.id };
  },

  commuterSummaryForBusiness(commuterId: string, businessId: string) {
    return db("users as u")
      .where("u.id", commuterId)
      .select("u.first_name", "u.last_name", "u.rating")
      .select(
        db.raw(
          "(select count(*) from premium_bookings b where b.commuter_id = u.id and b.business_id = ? and b.status in ('confirmed','active','completed','disputed'))::int as bookings",
          [businessId]
        ),
        db.raw("(select count(*) from premium_bookings b where b.commuter_id = u.id and b.business_id = ? and b.status = 'disputed')::int as disputes", [businessId])
      )
      .first();
  },

  depositForBooking(bookingId: string) {
    return db("protection_deposits").where({ booking_id: bookingId }).first();
  },

  async recordEvent(bookingId: string, kind: string, title: string, subtitle?: string, actorId?: string, trx?: Knex.Transaction) {
    await (trx ?? db)("booking_events").insert({ booking_id: bookingId, kind, title, subtitle: subtitle ?? null, actor_id: actorId ?? null });
  },

  eventsForBooking(bookingId: string) {
    return db("booking_events").where({ booking_id: bookingId }).orderBy("created_at", "asc");
  },

  inspectionForBooking(bookingId: string) {
    return db("booking_inspections").where({ booking_id: bookingId }).first();
  },

  /** Commission percentage currently configured by Routta (admin "premium rules"). */
  async commissionPct(): Promise<number> {
    const row = await db("premium_pricing_rules").where({ key: "commission" }).first();
    return row ? Number(row.value) : 20;
  },

  hasConfirmedOverlap(vehicleId: string, date: string, excludeBookingId?: string) {
    const q = db("premium_bookings").where({ vehicle_id: vehicleId, booking_date: date }).whereIn("status", ["confirmed", "active"]);
    if (excludeBookingId) q.andWhereNot({ id: excludeBookingId });
    return q.first("id");
  },

  isDayBlocked(vehicleId: string, date: string) {
    return db("premium_vehicle_blocked_days").where({ vehicle_id: vehicleId, day: date }).first("id");
  },

  blockedDaysInRange(vehicleId: string, from: string, to: string) {
    return db("premium_vehicle_blocked_days")
      .where({ vehicle_id: vehicleId })
      .andWhere("day", ">=", from)
      .andWhere("day", "<", to)
      .orderBy("day", "asc")
      .select(db.raw("to_char(day, 'YYYY-MM-DD') as day"), "reason");
  },

  bookedDaysInRange(vehicleId: string, from: string, to: string) {
    return db("premium_bookings")
      .where({ vehicle_id: vehicleId })
      .whereIn("status", ["requested", "confirmed", "active"])
      .andWhere("booking_date", ">=", from)
      .andWhere("booking_date", "<", to)
      .select(db.raw("to_char(booking_date, 'YYYY-MM-DD') as day"), "status");
  },

  async setBlockedDays(vehicleId: string, from: string, to: string, days: string[]) {
    await db.transaction(async (trx) => {
      const q = trx("premium_vehicle_blocked_days").where({ vehicle_id: vehicleId }).andWhere("day", ">=", from).andWhere("day", "<", to);
      if (days.length) q.whereNotIn("day", days);
      await q.del();
      if (days.length) {
        await trx("premium_vehicle_blocked_days")
          .insert(days.map((day) => ({ vehicle_id: vehicleId, day })))
          .onConflict(["vehicle_id", "day"])
          .ignore();
      }
    });
  },

  blockDay(vehicleId: string, day: string, reason?: string) {
    return db("premium_vehicle_blocked_days").insert({ vehicle_id: vehicleId, day, reason: reason ?? null }).onConflict(["vehicle_id", "day"]).ignore();
  },

  unblockDay(vehicleId: string, day: string) {
    return db("premium_vehicle_blocked_days").where({ vehicle_id: vehicleId, day }).del();
  },

  updateBusinessSettings(businessId: string, patch: Record<string, unknown>) {
    return db("businesses").where({ id: businessId }).update({ ...patch, updated_at: db.fn.now() }).returning("*");
  },

  // ---- Earnings ----
  completedBookingsBetween(businessId: string, from: string, to: string) {
    return db("premium_bookings as b")
      .leftJoin("premium_tiers as t", "t.id", "b.tier_id")
      .leftJoin("protection_deposits as pd", "pd.booking_id", "b.id")
      .where("b.business_id", businessId)
      .andWhere("b.status", "completed")
      .andWhere("b.booking_date", ">=", from)
      .andWhere("b.booking_date", "<", to)
      .select("b.*", "t.price as tier_price", "pd.status as deposit_status", "pd.claim_amount", "pd.refund_amount", "pd.held_amount");
  },

  async openDepositsHeld(businessId: string): Promise<number> {
    const row = await db("protection_deposits as pd")
      .join("premium_bookings as b", "b.id", "pd.booking_id")
      .where("b.business_id", businessId)
      .whereIn("pd.status", ["held", "disputed"])
      .whereIn("b.status", ["confirmed", "active", "completed", "disputed"])
      .sum<{ s: string }>("pd.held_amount as s")
      .first();
    return Number(row?.s ?? 0);
  },

  nextScheduledSettlement(businessId: string) {
    return db("settlements").where({ business_id: businessId, status: "scheduled" }).orderBy("period_end", "asc").first();
  },

  settlementsForBusiness(businessId: string) {
    return db("settlements")
      .where({ business_id: businessId })
      .orderBy("period_end", "desc")
      .select(
        "settlements.*",
        db.raw("to_char(period_start, 'YYYY-MM-DD') as period_start_d"),
        db.raw("to_char(period_end, 'YYYY-MM-DD') as period_end_d"),
        db.raw(
          "(select count(*) from premium_bookings b where b.business_id = settlements.business_id and b.status = 'completed' and b.booking_date >= settlements.period_start and b.booking_date <= settlements.period_end)::int as bookings_count"
        )
      );
  },
};
