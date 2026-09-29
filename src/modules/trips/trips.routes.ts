import { Router } from "express";
import { tripsController } from "./trips.controller";
import { requireAuth, requireUserType } from "@/common/middleware/auth";
import { validate } from "@/common/middleware/validate";
import * as v from "./trips.validation";

export const tripsRouter = Router();

tripsRouter.use(requireAuth);

// Quotes — either persona can price a route
tripsRouter.post("/quotes", validate(v.quoteSchema), tripsController.getQuotes);
tripsRouter.get("/capacity-options", validate(v.capacityQuerySchema, "query"), tripsController.getCapacityOptions);

// Commuter lifecycle
tripsRouter.post("/", requireUserType("commuter"), validate(v.requestTripSchema), tripsController.requestTrip);
tripsRouter.get("/history", requireUserType("commuter"), validate(v.historyQuerySchema, "query"), tripsController.history);
tripsRouter.post("/:id/rate", requireUserType("commuter"), validate(v.rateTripSchema), tripsController.rate);
tripsRouter.post("/:id/tip", requireUserType("commuter"), validate(v.tipSchema), tripsController.tip);

// Scheduled rides (commuter). Registered before "/:id" so "scheduled" is not treated as a trip id.
tripsRouter.get("/scheduled", requireUserType("commuter"), tripsController.scheduledList);
tripsRouter.post("/scheduled", requireUserType("commuter"), validate(v.scheduleRideSchema), tripsController.scheduledCreate);
tripsRouter.post("/scheduled/:id/cancel", requireUserType("commuter"), tripsController.scheduledCancel);
tripsRouter.delete("/scheduled/:id", requireUserType("commuter"), tripsController.scheduledCancel);

// Driver lifecycle
tripsRouter.get("/incoming", requireUserType("driver"), tripsController.listIncoming);
tripsRouter.get("/today", requireUserType("driver"), tripsController.today);
tripsRouter.post("/:id/accept", requireUserType("driver"), tripsController.accept);
tripsRouter.post("/:id/decline", requireUserType("driver"), validate(v.declineTripSchema), tripsController.decline);
tripsRouter.post("/:id/end-early", requireUserType("driver"), validate(v.endEarlySchema), tripsController.endEarly);
tripsRouter.post("/:id/verify-pin", requireUserType("driver"), validate(v.verifyPinSchema), tripsController.verifyPin);

// Shared (commuter or driver, ownership enforced in service)
tripsRouter.get("/:id", tripsController.getTrip);
tripsRouter.post("/:id/complete", tripsController.complete);
tripsRouter.post("/:id/cancel", validate(v.cancelTripSchema), tripsController.cancel);
