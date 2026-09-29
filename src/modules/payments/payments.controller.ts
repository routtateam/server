import { asyncHandler } from "@/common/utils/asyncHandler";
import { created, noContent, ok } from "@/common/utils/response";
import { paymentsService } from "./payments.service";
import { UnauthorizedError } from "@/common/utils/errors";

function uid(req: any): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

export const paymentsController = {
  getBalance: asyncHandler(async (req, res) => ok(res, { balance: await paymentsService.getWalletBalance(uid(req)) })),
  initiateTopUp: asyncHandler(async (req, res) => created(res, await paymentsService.initiateTopUp(uid(req), req.body.amount))),
  confirmTopUp: asyncHandler(async (req, res) => ok(res, await paymentsService.confirmTopUp(uid(req), req.params.reference))),

  monnifyWebhook: asyncHandler(async (req, res) => {
    const raw = (req.body as Buffer).toString("utf8");
    await paymentsService.handleMonnifyWebhook(raw, req.headers["monnify-signature"] as string | undefined);
    res.status(200).json({ received: true });
  }),

  listMethods: asyncHandler(async (req, res) => ok(res, await paymentsService.listPaymentMethods(uid(req)))),
  addCard: asyncHandler(async (req, res) => created(res, await paymentsService.addCard(uid(req), req.body))),
  removeCard: asyncHandler(async (req, res) => {
    await paymentsService.removeCard(uid(req), req.params.id);
    noContent(res);
  }),

  listPromotions: asyncHandler(async (_req, res) => ok(res, await paymentsService.listPromotions())),
  applyPromo: asyncHandler(async (req, res) => ok(res, await paymentsService.applyPromo(req.body.code))),
};
