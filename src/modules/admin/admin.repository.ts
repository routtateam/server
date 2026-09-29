import { db } from "@/db/knex";

export const adminRepository = {
  // ---- Overview ----
  countUsersByType(userType: string) {
    return db("users").where({ user_type: userType }).count<{ count: string }[]>("id as count").first();
  },
  countTripsByStatus(status: string) {
    return db("trips").where({ status }).count<{ count: string }[]>("id as count").first();
  },
  sumFaresToday() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return db("trips").where({ status: "completed" }).andWhere("completed_at", ">=", startOfDay).sum<{ sum: string }[]>("fare as sum").first();
  },

  // ---- Transporters / Commuters ----
  listTransporters(offset: number, limit: number) {
    return db("users as u")
      .join("driver_profiles as dp", "dp.user_id", "u.id")
      .leftJoin("vehicles as v", function join() {
        this.on("v.driver_id", "=", "u.id").andOn("v.is_active", "=", db.raw("true"));
      })
      .where("u.user_type", "driver")
      .orderBy("u.created_at", "desc")
      .offset(offset)
      .limit(limit)
      .select("u.*", "dp.total_trips", "dp.verified", "dp.total_earned", "v.plate", "v.make", "v.model");
  },
  countTransporters() {
    return db("users").where({ user_type: "driver" }).count<{ count: string }[]>("id as count").first();
  },

  listCommuters(offset: number, limit: number) {
    return db("users").where({ user_type: "commuter" }).orderBy("created_at", "desc").offset(offset).limit(limit);
  },
  countCommuters() {
    return db("users").where({ user_type: "commuter" }).count<{ count: string }[]>("id as count").first();
  },
  commuterStats(commuterId: string) {
    return db("trips")
      .where({ commuter_id: commuterId, status: "completed" })
      .select(db.raw("count(*) as trips"), db.raw("coalesce(sum(fare),0) as spent"));
  },

  // ---- Trips ----
  listTrips(offset: number, limit: number, status?: string) {
    let q = db("trips as t")
      .leftJoin("users as c", "c.id", "t.commuter_id")
      .leftJoin("users as d", "d.id", "t.driver_id")
      .orderBy("t.created_at", "desc")
      .offset(offset)
      .limit(limit)
      .select(
        "t.*",
        db.raw("concat(c.first_name, ' ', c.last_name) as commuter_name"),
        db.raw("concat(d.first_name, ' ', d.last_name) as driver_name")
      );
    if (status) q = q.where("t.status", status);
    return q;
  },
  countTrips(status?: string) {
    let q = db("trips");
    if (status) q = q.where({ status });
    return q.count<{ count: string }[]>("id as count").first();
  },
  reassignTrip(tripId: string, driverId: string) {
    return db("trips").where({ id: tripId }).update({ driver_id: driverId, updated_at: db.fn.now() }).returning("*");
  },

  // ---- Verifications ----
  driversPendingVerification() {
    return db("users as u")
      .join("driver_profiles as dp", "dp.user_id", "u.id")
      .where("dp.verified", false)
      .select("u.*", "dp.*");
  },
  documentsForDriver(driverId: string) {
    return db("documents")
      .leftJoin("vehicles", function join() {
        this.on("vehicles.id", "=", "documents.owner_id").andOn("documents.owner_type", "=", db.raw("'vehicle'"));
      })
      .where(function w() {
        this.where({ owner_type: "driver", owner_id: driverId }).orWhere(function sub() {
          this.where("documents.owner_type", "vehicle").andWhere("vehicles.driver_id", driverId);
        });
      })
      .select("documents.*");
  },
  vehicleForDriver(driverId: string) {
    return db("vehicles").where({ driver_id: driverId, is_active: true }).first();
  },
  async approveDriver(driverId: string) {
    // Approval also activates a pending applicant (created via POST /auth/driver/apply).
    await db("users").where({ id: driverId, status: "pending" }).update({ status: "active", updated_at: db.fn.now() });
    return db("driver_profiles").where({ user_id: driverId }).update({ verified: true, updated_at: db.fn.now() });
  },
  rejectDriver(driverId: string) {
    return db("driver_profiles").where({ user_id: driverId }).update({ verified: false, updated_at: db.fn.now() });
  },
  flagDocumentForReupload(documentId: string) {
    return db("documents").where({ id: documentId }).update({ status: "rejected", updated_at: db.fn.now() });
  },

  // ---- Disputes ----
  listDisputes(offset: number, limit: number, status?: string) {
    let q = db("disputes as d")
      .leftJoin("trips as t", "t.id", "d.trip_id")
      .leftJoin("users as u", "u.id", "d.raised_by")
      .leftJoin("users as c", "c.id", "t.commuter_id")
      .leftJoin("users as dr", "dr.id", "t.driver_id")
      .orderBy("d.created_at", "desc")
      .offset(offset)
      .limit(limit)
      .select(
        "d.*",
        "t.commuter_id",
        "t.driver_id",
        "t.fare as trip_fare",
        "t.promo_discount as trip_promo_discount",
        "u.user_type as raised_by_role",
        db.raw("concat(u.first_name, ' ', u.last_name) as raised_by_name"),
        db.raw("nullif(trim(concat(c.first_name, ' ', c.last_name)), '') as commuter_name"),
        db.raw("nullif(trim(concat(dr.first_name, ' ', dr.last_name)), '') as transporter_name")
      );
    if (status) q = q.where("d.status", status);
    return q;
  },
  countDisputes(status?: string) {
    let q = db("disputes");
    if (status) q = q.where({ status });
    return q.count<{ count: string }[]>("id as count").first();
  },
  resolveDispute(id: string, note?: string) {
    return db("disputes").where({ id }).update({ status: "resolved", resolution_note: note, updated_at: db.fn.now() }).returning("*");
  },

  // ---- Support ----
  listSupportTickets(offset: number, limit: number) {
    return db("support_tickets as t")
      .leftJoin("users as u", "u.id", "t.requester_id")
      .leftJoin("users as a", "a.id", "t.assignee_id")
      .orderBy("t.created_at", "desc")
      .offset(offset)
      .limit(limit)
      .select(
        "t.*",
        db.raw("nullif(trim(concat(u.first_name, ' ', u.last_name)), '') as requester_name"),
        "u.user_type as requester_role",
        db.raw("nullif(trim(concat(a.first_name, ' ', a.last_name)), '') as assignee_name"),
        db.raw("(select count(*) from ticket_messages m where m.ticket_id = t.id)::int as message_count")
      );
  },
  updateSupportTicket(id: string, patch: Record<string, unknown>) {
    return db("support_tickets").where({ id }).update({ ...patch, updated_at: db.fn.now() }).returning("*");
  },

  // ---- Pricing ----
  listPricingRules() {
    return db("pricing_rules").select("*");
  },
  updatePricingRule(category: string, patch: Record<string, unknown>) {
    return db("pricing_rules").where({ category }).update({ ...patch, updated_at: db.fn.now() });
  },

  // ---- Promotions ----
  listPromotions() {
    return db("promotions").orderBy("created_at", "desc");
  },
  createPromotion(input: Record<string, unknown>) {
    return db("promotions").insert(input).returning("*");
  },
  updatePromotion(code: string, patch: Record<string, unknown>) {
    return db("promotions").whereRaw("lower(code) = lower(?)", [code]).update({ ...patch, updated_at: db.fn.now() }).returning("*");
  },

  // ---- Payouts ----
  listPayouts(offset: number, limit: number, status?: string) {
    let q = db("payouts as p")
      .join("users as u", "u.id", "p.driver_id")
      .orderBy("p.requested_at", "desc")
      .offset(offset)
      .limit(limit)
      .select("p.*", db.raw("concat(u.first_name, ' ', u.last_name) as driver_name"));
    if (status) q = q.where("p.status", status);
    return q;
  },
  countPayouts(status?: string) {
    let q = db("payouts");
    if (status) q = q.where({ status });
    return q.count<{ count: string }[]>("id as count").first();
  },
  approvePayout(id: string) {
    return db("payouts").where({ id }).update({ status: "processing", updated_at: db.fn.now() }).returning("*");
  },
  approveAllPendingPayouts() {
    return db("payouts").where({ status: "pending" }).update({ status: "processing", updated_at: db.fn.now() }).returning("id");
  },

  // ---- Premium ride oversight ----
  listBusinesses() {
    return db("businesses").orderBy("created_at", "desc");
  },
  findBusiness(id: string) {
    return db("businesses").where({ id }).first();
  },
  updateBusinessStatus(id: string, status: string) {
    return db("businesses").where({ id }).update({ status, updated_at: db.fn.now() }).returning("*");
  },
  listAllPremiumVehicles() {
    return db("premium_vehicles as pv").join("businesses as b", "b.id", "pv.business_id").select("pv.*", "b.name as business_name");
  },
  updatePremiumVehicleStatus(id: string, status: string) {
    return db("premium_vehicles").where({ id }).update({ status, updated_at: db.fn.now() }).returning("*");
  },
  listAllPremiumBookings() {
    return db("premium_bookings as pb")
      .join("businesses as b", "b.id", "pb.business_id")
      .join("premium_vehicles as pv", "pv.id", "pb.vehicle_id")
      .select("pb.*", "b.name as business_name", "pv.name as vehicle_name");
  },
  listProtectionDeposits() {
    return db("protection_deposits as pd").join("premium_bookings as pb", "pb.id", "pd.booking_id").select("pd.*", "pb.business_id");
  },
  actOnDeposit(id: string, action: "refund" | "deduct") {
    const patch =
      action === "refund" ? { status: "refunded", refund_amount: db.raw("held_amount") } : { status: "claimed", claim_amount: db.raw("held_amount") };
    return db("protection_deposits").where({ id }).update({ ...patch, updated_at: db.fn.now() }).returning("*");
  },
  listSettlements() {
    return db("settlements as s").join("businesses as b", "b.id", "s.business_id").select("s.*", "b.name as business_name");
  },
  listPremiumPricingRules() {
    return db("premium_pricing_rules").select("*");
  },
  updatePremiumPricingRule(key: string, value: number) {
    return db("premium_pricing_rules").where({ key }).update({ value, updated_at: db.fn.now() });
  },

  // ---- Team & roles ----
  listAdmins() {
    return db("users as u")
      .join("user_roles as ur", "ur.user_id", "u.id")
      .join("roles as r", "r.id", "ur.role_id")
      .where("u.user_type", "admin")
      .select("u.*", "r.name as role_name");
  },
  listRoles() {
    return db("roles").select("*");
  },
  rolePermissions(roleId: string) {
    return db("role_permissions as rp").join("permissions as p", "p.id", "rp.permission_id").where("rp.role_id", roleId).select("p.key");
  },
  findRoleByName(name: string) {
    return db("roles").where({ name }).first();
  },
  createAdminInvite(email: string, roleId: string, invitedBy: string) {
    return db("admin_invites").insert({ email, role_id: roleId, invited_by: invitedBy }).returning("*");
  },
};
