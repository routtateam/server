import { Router } from "express";
import { adminController } from "./admin.controller";
import { requireAuth, requireUserType } from "@/common/middleware/auth";
import { requirePermission } from "@/common/middleware/rbac";
import { validate } from "@/common/middleware/validate";
import * as v from "./admin.validation";
import * as sv from "@/modules/support/support.validation";

export const adminRouter = Router();

adminRouter.use(requireAuth, requireUserType("admin"));

adminRouter.get("/overview", requirePermission("dashboard.view"), adminController.overview);

adminRouter.get("/transporters", requirePermission("transporters.view"), validate(v.paginationQuerySchema, "query"), adminController.listTransporters);
adminRouter.get("/commuters", requirePermission("commuters.view"), validate(v.paginationQuerySchema, "query"), adminController.listCommuters);

adminRouter.get("/trips", requirePermission("trips.view"), validate(v.paginationQuerySchema, "query"), adminController.listTrips);
adminRouter.post("/trips/:id/reassign", requirePermission("trips.reassign"), validate(v.reassignTripSchema), adminController.reassignTrip);

adminRouter.get("/verifications", requirePermission("verifications.view"), adminController.listVerifications);
adminRouter.post("/verifications/:id/approve", requirePermission("verifications.review"), adminController.approveApplicant);
adminRouter.post("/verifications/:id/reject", requirePermission("verifications.review"), adminController.rejectApplicant);
adminRouter.post(
  "/verifications/:id/request-document",
  requirePermission("verifications.review"),
  validate(v.requestClearerDocumentSchema),
  adminController.requestClearerDocument
);

adminRouter.get("/disputes", requirePermission("disputes.view"), validate(v.paginationQuerySchema, "query"), adminController.listDisputes);
adminRouter.post("/disputes/:id/resolve", requirePermission("disputes.resolve"), validate(v.resolveDisputeSchema), adminController.resolveDispute);

adminRouter.get("/disputes/:id", requirePermission("disputes.view"), adminController.disputeDetail);
adminRouter.post("/disputes/:id/reply", requirePermission("disputes.resolve"), validate(sv.messageSchema), adminController.replyDispute);
adminRouter.post("/disputes/:id/escalate", requirePermission("disputes.resolve"), validate(sv.escalateSchema), adminController.escalateDispute);

adminRouter.get("/support", requirePermission("support.view"), validate(v.paginationQuerySchema, "query"), adminController.listSupportTickets);
adminRouter.get("/support/:id", requirePermission("support.view"), adminController.ticketDetail);
adminRouter.post("/support/:id/reply", requirePermission("support.manage"), validate(sv.messageSchema), adminController.replyTicket);
adminRouter.post("/support/:id/escalate", requirePermission("support.manage"), validate(sv.escalateSchema), adminController.escalateTicket);
adminRouter.patch("/support/:id", requirePermission("support.manage"), validate(v.supportTicketUpdateSchema), adminController.updateSupportTicket);

adminRouter.get("/pricing", requirePermission("pricing.view"), adminController.getFeeCards);
adminRouter.put("/pricing", requirePermission("pricing.manage"), validate(v.savePricingSchema), adminController.saveRates);

adminRouter.get("/promotions", requirePermission("promotions.view"), adminController.listPromotions);
adminRouter.post("/promotions", requirePermission("promotions.manage"), validate(v.createPromotionSchema), adminController.createPromotion);
adminRouter.patch("/promotions/:code", requirePermission("promotions.manage"), validate(v.updatePromotionSchema), adminController.updatePromotion);

adminRouter.get("/payouts", requirePermission("payouts.view"), validate(v.paginationQuerySchema, "query"), adminController.listPayouts);
adminRouter.post("/payouts/:id/approve", requirePermission("payouts.approve"), adminController.approvePayout);
adminRouter.post("/payouts/approve-all", requirePermission("payouts.approve"), adminController.approveAllPending);

adminRouter.get("/premium/businesses", requirePermission("premium.view"), adminController.listBusinesses);
adminRouter.post("/premium/businesses/:id", requirePermission("premium.manage"), validate(v.premiumActionSchema), adminController.actOnBusiness);
adminRouter.get("/premium/vehicles", requirePermission("premium.view"), adminController.listAllPremiumVehicles);
adminRouter.post("/premium/vehicles/:id", requirePermission("premium.manage"), validate(v.premiumActionSchema), adminController.actOnPremiumVehicle);
adminRouter.get("/premium/bookings", requirePermission("premium.view"), adminController.listAllPremiumBookings);
adminRouter.get("/premium/deposits", requirePermission("premium.view"), adminController.listProtectionDeposits);
adminRouter.post("/premium/deposits/:id", requirePermission("premium.manage"), validate(v.depositActionSchema), adminController.actOnDeposit);
adminRouter.get("/premium/settlements", requirePermission("premium.view"), adminController.listSettlements);
adminRouter.post("/premium/settlements/run", requirePermission("premium.manage"), adminController.runSettlement);
adminRouter.get("/premium/rules", requirePermission("premium.view"), adminController.getPremiumRules);
adminRouter.put("/premium/rules", requirePermission("premium.manage"), validate(v.premiumRulesSchema), adminController.savePremiumRules);

adminRouter.get("/team", requirePermission("team.view"), adminController.listAdmins);
adminRouter.get("/team/roles", requirePermission("team.view"), adminController.listRoles);
adminRouter.post("/team/invite", requirePermission("team.manage"), validate(v.inviteAdminSchema), adminController.inviteAdmin);
