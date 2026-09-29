import { adminRepository } from "./admin.repository";
import { slaInfo } from "@/modules/support/support.sla";
import { NotFoundError, ValidationError } from "@/common/utils/errors";
import { eventBus, DomainEvents } from "@/events/eventBus";
import { dispatchNotification, dispatchPayout } from "@/jobs/dispatch";

function docStatusToCheck(status: string): "ok" | "flag" | "missing" {
  if (status === "current") return "ok";
  if (status === "missing" || status === "expired" || status === "rejected") return "flag";
  return "ok";
}

export const adminService = {
  async overview() {
    const [drivers, commuters, activeTrips, completedToday, faresToday] = await Promise.all([
      adminRepository.countUsersByType("driver"),
      adminRepository.countUsersByType("commuter"),
      adminRepository.countTripsByStatus("in_progress"),
      adminRepository.countTripsByStatus("completed"),
      adminRepository.sumFaresToday(),
    ]);
    return {
      drivers: Number(drivers?.count ?? 0),
      commuters: Number(commuters?.count ?? 0),
      activeTrips: Number(activeTrips?.count ?? 0),
      completedTrips: Number(completedToday?.count ?? 0),
      grossFaresToday: Number(faresToday?.sum ?? 0),
    };
  },

  async listTransporters(page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    const [rows, count] = await Promise.all([adminRepository.listTransporters(offset, pageSize), adminRepository.countTransporters()]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        initials: `${(r.first_name ?? "?")[0] ?? ""}${(r.last_name ?? "?")[0] ?? ""}`.toUpperCase(),
        name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
        vehicle: [r.make, r.model].filter(Boolean).join(" "),
        plate: r.plate ?? "",
        rating: Number(r.rating).toFixed(1),
        trips: r.total_trips,
        weekEarnings: 0,
        status: r.status === "suspended" ? "Suspended" : r.verified ? "Active" : "Pending",
      })),
      total: Number(count?.count ?? 0),
      page,
      pageSize,
    };
  },

  async listCommuters(page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    const [rows, count] = await Promise.all([adminRepository.listCommuters(offset, pageSize), adminRepository.countCommuters()]);
    const items = await Promise.all(
      rows.map(async (r) => {
        const [stats] = await adminRepository.commuterStats(r.id);
        return {
          id: r.id,
          initials: `${(r.first_name ?? "?")[0] ?? ""}${(r.last_name ?? "?")[0] ?? ""}`.toUpperCase(),
          name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
          joined: r.created_at,
          trips: Number(stats?.trips ?? 0),
          spent: Number(stats?.spent ?? 0),
          rated: Number(r.rating).toFixed(1),
          status: r.status === "flagged" ? "Flagged" : "Active",
        };
      })
    );
    return { items, total: Number(count?.count ?? 0), page, pageSize };
  },

  async listTrips(page: number, pageSize: number, status?: string) {
    const offset = (page - 1) * pageSize;
    const [rows, count] = await Promise.all([adminRepository.listTrips(offset, pageSize, status), adminRepository.countTrips(status)]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        route: `${r.pickup_label} → ${r.destination_label}`,
        commuter: r.commuter_name,
        transporter: r.driver_name ?? "Unassigned",
        fare: Number(r.fare),
        status: r.status,
        live: ["accepted", "enroute", "arrived", "in_progress"].includes(r.status),
      })),
      total: Number(count?.count ?? 0),
      page,
      pageSize,
    };
  },

  async reassignTrip(tripId: string, driverId: string) {
    const [row] = await adminRepository.reassignTrip(tripId, driverId);
    if (!row) throw new NotFoundError("Trip not found");
    const { pin: _pin, ...safe } = row; // never serialise the arrival PIN
    return safe;
  },

  async listVerifications() {
    const drivers = await adminRepository.driversPendingVerification();
    return Promise.all(
      drivers.map(async (d) => {
        const [docs, vehicle] = await Promise.all([adminRepository.documentsForDriver(d.user_id), adminRepository.vehicleForDriver(d.user_id)]);
        return {
          id: d.user_id,
          name: `${d.first_name ?? ""} ${d.last_name ?? ""}`.trim(),
          category: vehicle?.category ?? "car",
          appliedAgo: d.created_at,
          phone: d.phone,
          flag: docs.some((doc: any) => ["missing", "expired", "rejected"].includes(doc.status)) ? "Document needs attention" : null,
          documents: docs.map((doc: any) => ({ name: doc.doc_name, status: docStatusToCheck(doc.status), meta: doc.meta ?? "" })),
        };
      })
    );
  },

  async approveApplicant(driverId: string) {
    await adminRepository.approveDriver(driverId);
    await dispatchNotification({
      userId: driverId,
      title: "You're verified!",
      body: "Your documents were approved. You can start accepting trips now.",
      kind: "doc",
    });
    eventBus.publish(DomainEvents.DriverVerificationReviewed, { driverId, verdict: "approved" });
    return { message: "Applicant approved" };
  },

  async rejectApplicant(driverId: string) {
    await adminRepository.rejectDriver(driverId);
    await dispatchNotification({
      userId: driverId,
      title: "Verification update",
      body: "Your application needs attention — please re-apply in 30 days.",
      kind: "doc",
    });
    eventBus.publish(DomainEvents.DriverVerificationReviewed, { driverId, verdict: "rejected" });
    return { message: "Applicant rejected" };
  },

  async requestClearerDocument(documentId: string, driverId: string) {
    await adminRepository.flagDocumentForReupload(documentId);
    await dispatchNotification({
      userId: driverId,
      title: "Document needs re-upload",
      body: "One of your documents was flagged. Please re-upload a clearer copy.",
      kind: "doc",
    });
    return { message: "Reminder sent" };
  },

  async listDisputes(page: number, pageSize: number, status?: string) {
    const offset = (page - 1) * pageSize;
    const [rows, count] = await Promise.all([adminRepository.listDisputes(offset, pageSize, status), adminRepository.countDisputes(status)]);
    const items = rows.map((r: any) => {
      const sla = slaInfo(r, r.status === "resolved");
      return { ...r, sla_status: sla.slaStatus, sla_remaining_minutes: sla.slaRemainingMinutes };
    });
    return { items, total: Number(count?.count ?? 0), page, pageSize };
  },

  async resolveDispute(id: string, note?: string) {
    const [row] = await adminRepository.resolveDispute(id, note);
    if (!row) throw new NotFoundError("Dispute not found");
    return row;
  },

  async listSupportTickets(page: number, pageSize: number) {
    const offset = (page - 1) * pageSize;
    const rows = await adminRepository.listSupportTickets(offset, pageSize);
    return rows.map((r: any) => {
      const sla = slaInfo(r, ["resolved", "closed"].includes(r.status));
      return { ...r, sla_status: sla.slaStatus, sla_remaining_minutes: sla.slaRemainingMinutes };
    });
  },

  async updateSupportTicket(id: string, patch: { status?: string; assigneeId?: string }) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.status) dbPatch.status = patch.status;
    if (patch.assigneeId) dbPatch.assignee_id = patch.assigneeId;
    const [row] = await adminRepository.updateSupportTicket(id, dbPatch);
    if (!row) throw new NotFoundError("Support ticket not found");
    return row;
  },

  async getFeeCards() {
    const rows = await adminRepository.listPricingRules();
    return rows.map((r) => ({
      category: r.category,
      name: r.name,
      caption: r.caption,
      feePercent: Number(r.fee_percent),
      ratePerKm: Number(r.rate_per_km),
      sample: r.sample,
    }));
  },

  async saveRates(rules: Array<{ category: string; feePercent: number; ratePerKm: number }>) {
    await Promise.all(rules.map((r) => adminRepository.updatePricingRule(r.category, { fee_percent: r.feePercent, rate_per_km: r.ratePerKm })));
    return { message: "Pricing saved — live on both apps immediately.", cards: await this.getFeeCards() };
  },

  async listPromotions() {
    const rows = await adminRepository.listPromotions();
    return rows.map((r) => ({
      code: r.code,
      description: r.description,
      scope: r.category_scope,
      uses: `${r.used_count}${r.usage_limit ? `/${r.usage_limit}` : ""}`,
      ends: r.ends_at,
      status: r.status === "active" ? "Active" : r.status === "scheduled" ? "Scheduled" : "Expired",
      on: r.status === "active",
    }));
  },

  async createPromotion(input: any) {
    const [row] = await adminRepository.createPromotion({
      code: input.code.toUpperCase(),
      description: input.description,
      discount_type: input.discountType,
      discount_value: input.discountValue,
      category_scope: input.categoryScope,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      usage_limit: input.usageLimit,
    });
    return row;
  },

  async updatePromotion(code: string, patch: { status?: string; description?: string }) {
    const dbPatch: Record<string, unknown> = {};
    if (patch.status) dbPatch.status = patch.status;
    if (patch.description) dbPatch.description = patch.description;
    const [row] = await adminRepository.updatePromotion(code, dbPatch);
    if (!row) throw new NotFoundError("Promotion not found");
    return row;
  },

  async listPayouts(page: number, pageSize: number, status?: string) {
    const offset = (page - 1) * pageSize;
    const [rows, count] = await Promise.all([adminRepository.listPayouts(offset, pageSize, status), adminRepository.countPayouts(status)]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        initials: r.driver_name
          .split(" ")
          .map((w: string) => w[0])
          .join(""),
        name: r.driver_name,
        amount: Number(r.amount),
        requested: r.requested_at,
        status: r.status === "paid" ? "Paid" : r.status === "processing" ? "Processing" : "Pending",
      })),
      total: Number(count?.count ?? 0),
      page,
      pageSize,
    };
  },

  async approvePayout(id: string) {
    const [row] = await adminRepository.approvePayout(id);
    if (!row) throw new NotFoundError("Payout not found");
    await dispatchPayout(id);
    return { message: `${row.driver_id}'s payout of ₦${(Number(row.amount) / 100).toLocaleString()} approved` };
  },

  async approveAllPending() {
    const rows = await adminRepository.approveAllPendingPayouts();
    await Promise.all(rows.map((r: any) => dispatchPayout(r.id)));
    return { message: "All pending payouts approved" };
  },

  // ---- Premium ride oversight ----
  async listBusinesses() {
    return adminRepository.listBusinesses();
  },

  async actOnBusiness(id: string, action: "approve" | "reject" | "suspend" | "request-changes") {
    const statusMap: Record<string, string> = { approve: "verified", reject: "action_required", suspend: "suspended", "request-changes": "action_required" };
    const [row] = await adminRepository.updateBusinessStatus(id, statusMap[action]);
    if (!row) throw new NotFoundError("Business not found");
    return { message: `${row.name} ${action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "suspend" ? "suspended" : "changes requested"}` };
  },

  async listAllPremiumVehicles() {
    return adminRepository.listAllPremiumVehicles();
  },

  async actOnPremiumVehicle(id: string, action: "approve" | "reject" | "suspend" | "request-changes") {
    const statusMap: Record<string, string> = { approve: "live", reject: "rejected", suspend: "suspended", "request-changes": "under_review" };
    const [row] = await adminRepository.updatePremiumVehicleStatus(id, statusMap[action]);
    if (!row) throw new NotFoundError("Vehicle not found");
    return { message: `${row.name} ${action}d` };
  },

  async listAllPremiumBookings() {
    return adminRepository.listAllPremiumBookings();
  },

  async listProtectionDeposits() {
    return adminRepository.listProtectionDeposits();
  },

  async actOnDeposit(id: string, action: "refund" | "deduct") {
    const [row] = await adminRepository.actOnDeposit(id, action);
    if (!row) throw new NotFoundError("Deposit not found");
    return { message: `${id} ${action === "refund" ? "fully refunded" : "deduction confirmed"}` };
  },

  async listSettlements() {
    return adminRepository.listSettlements();
  },

  async runSettlement() {
    // Real settlement batch computation would aggregate premium_bookings by
    // business per period; kept as a stub trigger point for that job.
    return { message: "Settlement run started for all scheduled businesses" };
  },

  async getPremiumRules() {
    const rows = await adminRepository.listPremiumPricingRules();
    return rows.map((r) => ({ key: r.key, label: r.label, sub: r.sub, value: Number(r.value), unit: r.unit }));
  },

  async savePremiumRules(rules: Array<{ key: string; value: number }>) {
    await Promise.all(rules.map((r) => adminRepository.updatePremiumPricingRule(r.key, r.value)));
    return { message: "Premium Ride pricing rules saved", rules: await this.getPremiumRules() };
  },

  // ---- Team & roles ----
  async listAdmins() {
    const rows = await adminRepository.listAdmins();
    return rows.map((r) => ({
      id: r.id,
      initials: `${(r.first_name ?? "?")[0] ?? ""}${(r.last_name ?? "?")[0] ?? ""}`.toUpperCase(),
      name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(),
      email: r.email,
      role: r.role_name,
      lastActive: r.last_active_at,
      status: r.status === "suspended" ? "Suspended" : "Active",
    }));
  },

  async listRoles() {
    const roles = await adminRepository.listRoles();
    return Promise.all(
      roles.map(async (r) => ({
        name: r.name,
        description: r.description,
        permissions: (await adminRepository.rolePermissions(r.id)).map((p) => p.key),
      }))
    );
  },

  async inviteAdmin(email: string, roleName: string, invitedByUserId: string) {
    const role = await adminRepository.findRoleByName(roleName);
    if (!role) throw new ValidationError("Unknown role");
    await adminRepository.createAdminInvite(email, role.id, invitedByUserId);
    return { message: `Invite sent to ${email}` };
  },
};
