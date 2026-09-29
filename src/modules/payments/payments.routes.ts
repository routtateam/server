import { Router, raw } from "express";
import { paymentsController } from "./payments.controller";
import { requireAuth } from "@/common/middleware/auth";
import { validate } from "@/common/middleware/validate";
import * as v from "./payments.validation";

export const paymentsRouter = Router();

// Monnify webhook must read the raw body (for signature verification) and
// cannot require our own bearer auth — Monnify calls this directly.
paymentsRouter.post("/webhooks/monnify", raw({ type: "*/*" }), paymentsController.monnifyWebhook);

paymentsRouter.use(requireAuth);

paymentsRouter.get("/wallet", paymentsController.getBalance);
paymentsRouter.post("/wallet/topup", validate(v.topUpSchema), paymentsController.initiateTopUp);
paymentsRouter.post("/wallet/topup/:reference/confirm", paymentsController.confirmTopUp);

paymentsRouter.get("/methods", paymentsController.listMethods);
paymentsRouter.post("/methods", validate(v.addCardSchema), paymentsController.addCard);
paymentsRouter.delete("/methods/:id", paymentsController.removeCard);

paymentsRouter.get("/promotions", paymentsController.listPromotions);
paymentsRouter.post("/promotions/apply", validate(v.applyPromoSchema), paymentsController.applyPromo);
