import { Router } from "express";
import { premiumController } from "./premium.controller";
import { requireAuth, requireUserType } from "@/common/middleware/auth";
import { validate } from "@/common/middleware/validate";
import * as v from "./premium.validation";

// Commuter-facing marketplace — mounted at /api/v1/premium
export const premiumRouter = Router();
premiumRouter.get("/vehicles", premiumController.listVehicles);
premiumRouter.get("/vehicles/featured", premiumController.getFeatured);
premiumRouter.get("/vehicles/:id", premiumController.getVehicle);
premiumRouter.get("/businesses/:id", premiumController.getBusiness);
premiumRouter.use(requireAuth, requireUserType("commuter"));
premiumRouter.post("/bookings", validate(v.createBookingSchema), premiumController.createBooking);
premiumRouter.get("/bookings/active", premiumController.getActiveBooking);
premiumRouter.get("/bookings/history", premiumController.getBookingHistory);

// Business-partner dashboard — mounted at /api/v1/premium-business
export const premiumBusinessRouter = Router();
premiumBusinessRouter.use(requireAuth, requireUserType("business"));
premiumBusinessRouter.get("/vehicles", premiumController.listMyVehicles);
premiumBusinessRouter.post("/vehicles", validate(v.createVehicleSchema), premiumController.createMyVehicle);
premiumBusinessRouter.patch("/vehicles/:id", validate(v.updateVehicleSchema), premiumController.updateMyVehicle);
premiumBusinessRouter.get("/vehicles/:id", validate(v.uuidParamSchema, "params"), premiumController.getMyVehicle);
premiumBusinessRouter.put("/vehicles/:id/tiers", validate(v.uuidParamSchema, "params"), validate(v.updateTiersSchema), premiumController.updateTiers);
premiumBusinessRouter.get("/vehicles/:id/availability", validate(v.uuidParamSchema, "params"), validate(v.availabilityQuerySchema, "query"), premiumController.getAvailability);
premiumBusinessRouter.put("/vehicles/:id/availability", validate(v.uuidParamSchema, "params"), validate(v.setBlockedDaysSchema), premiumController.setBlockedDays);
premiumBusinessRouter.post("/vehicles/:id/availability/blocked", validate(v.uuidParamSchema, "params"), validate(v.blockDaySchema), premiumController.blockDay);
premiumBusinessRouter.delete("/vehicles/:id/availability/blocked/:date", validate(v.dateParamSchema, "params"), premiumController.unblockDay);

premiumBusinessRouter.get("/bookings", validate(v.bookingListQuerySchema, "query"), premiumController.listBookings);
premiumBusinessRouter.get("/bookings/requests", premiumController.listRequests);
premiumBusinessRouter.get("/bookings/:id", premiumController.getBooking);
premiumBusinessRouter.get("/bookings/:id/timeline", premiumController.bookingTimeline);
premiumBusinessRouter.post("/bookings/:id/accept", premiumController.acceptBooking);
premiumBusinessRouter.post("/bookings/:id/decline", validate(v.declineBookingSchema), premiumController.declineBooking);
premiumBusinessRouter.post("/bookings/:id/start", premiumController.startBooking);
premiumBusinessRouter.post("/bookings/:id/inspection", validate(v.inspectionSchema), premiumController.submitInspection);

premiumBusinessRouter.get("/settings", premiumController.getSettings);
premiumBusinessRouter.patch("/settings", validate(v.partnerSettingsSchema), premiumController.updateSettings);
premiumBusinessRouter.get("/earnings/summary", premiumController.earningsSummary);
premiumBusinessRouter.get("/payouts", premiumController.payouts);
premiumBusinessRouter.get("/payout-account", premiumController.getPayoutAccount);
premiumBusinessRouter.put("/payout-account", validate(v.payoutAccountSchema), premiumController.setPayoutAccount);
premiumBusinessRouter.get("/team", premiumController.listMyTeam);
premiumBusinessRouter.post("/team/invite", validate(v.inviteTeamMemberSchema), premiumController.inviteMyTeamMember);
