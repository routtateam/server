import { Router } from "express";
import { requireAuth, requireUserType } from "@/common/middleware/auth";
import { validate } from "@/common/middleware/validate";
import { asyncHandler } from "@/common/utils/asyncHandler";
import { created, ok } from "@/common/utils/response";
import { supportService } from "./support.service";
import * as v from "./support.validation";

// Commuter + driver support: disputes and tickets, each with a message thread. Mounted at /api/v1/support.
// Everything is scoped to the caller; admin handling lives under /api/v1/admin (RBAC-gated).
export const supportRouter = Router();
supportRouter.use(requireAuth, requireUserType("commuter", "driver"));

const uid = (req: any): string => req.user.id;

supportRouter.get("/disputes", asyncHandler(async (req, res) => ok(res, await supportService.listDisputes(uid(req)))));
supportRouter.post("/disputes", validate(v.createDisputeSchema), asyncHandler(async (req, res) => created(res, await supportService.createDispute(uid(req), req.body))));
supportRouter.get("/disputes/:id", asyncHandler(async (req, res) => ok(res, await supportService.getDispute(uid(req), req.params.id))));
supportRouter.post(
  "/disputes/:id/messages",
  validate(v.messageSchema),
  asyncHandler(async (req, res) => created(res, await supportService.postDisputeMessage(uid(req), req.params.id, req.body.body)))
);

supportRouter.get("/tickets", asyncHandler(async (req, res) => ok(res, await supportService.listTickets(uid(req)))));
supportRouter.post("/tickets", validate(v.createTicketSchema), asyncHandler(async (req, res) => created(res, await supportService.createTicket(uid(req), req.body))));
supportRouter.get("/tickets/:id", asyncHandler(async (req, res) => ok(res, await supportService.getTicket(uid(req), req.params.id))));
supportRouter.post(
  "/tickets/:id/messages",
  validate(v.messageSchema),
  asyncHandler(async (req, res) => created(res, await supportService.postTicketMessage(uid(req), req.params.id, req.body.body)))
);
