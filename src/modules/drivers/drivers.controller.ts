import { asyncHandler } from "@/common/utils/asyncHandler";
import { created, ok } from "@/common/utils/response";
import { driversService } from "./drivers.service";
import { UnauthorizedError } from "@/common/utils/errors";

function uid(req: any): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

export const driversController = {
  getMe: asyncHandler(async (req, res) => ok(res, await driversService.getMe(uid(req)))),
  updateMe: asyncHandler(async (req, res) => ok(res, await driversService.updateMe(uid(req), req.body))),
  setOnline: asyncHandler(async (req, res) => ok(res, await driversService.setOnline(uid(req), req.body.online))),
  reportLocation: asyncHandler(async (req, res) => ok(res, await driversService.reportLocation(uid(req), req.body.lat, req.body.lng))),

  getVehicle: asyncHandler(async (req, res) => ok(res, await driversService.getVehicle(uid(req)))),
  upsertVehicle: asyncHandler(async (req, res) => ok(res, await driversService.upsertVehicle(uid(req), req.body))),

  listDocuments: asyncHandler(async (req, res) => ok(res, await driversService.listDocuments(uid(req)))),
  uploadRenewal: asyncHandler(async (req, res) =>
    ok(res, await driversService.uploadRenewal(uid(req), req.params.key, req.body.fileUrl))
  ),

  earningsPeriod: asyncHandler(async (req, res) => ok(res, await driversService.earningsPeriod(uid(req), req.query.period as any))),
  ledger: asyncHandler(async (req, res) => ok(res, await driversService.ledger(uid(req)))),
  availableBalance: asyncHandler(async (req, res) => ok(res, await driversService.availableBalance(uid(req)))),
  quotePayout: asyncHandler(async (req, res) => ok(res, await driversService.quotePayout(uid(req), req.body.amount))),
  dashboard: asyncHandler(async (req, res) => ok(res, await driversService.dashboard(uid(req)))),
  getPayoutAccount: asyncHandler(async (req, res) => ok(res, await driversService.getPayoutAccount(uid(req)))),
  setPayoutAccount: asyncHandler(async (req, res) => ok(res, await driversService.setPayoutAccount(uid(req), req.body))),
  getSettings: asyncHandler(async (req, res) => ok(res, await driversService.getSettings(uid(req)))),
  updateSettings: asyncHandler(async (req, res) => ok(res, await driversService.updateSettings(uid(req), req.body))),
  uploadDocument: asyncHandler(async (req, res) => {
    const file = (req as any).file as { buffer: Buffer; size: number } | undefined;
    created(res, await driversService.uploadDocumentFile(uid(req), req.params.key, file));
  }),
  confirmPayout: asyncHandler(async (req, res) => ok(res, await driversService.confirmPayout(uid(req), req.body.amount))),

  reviews: asyncHandler(async (req, res) => ok(res, await driversService.reviews(uid(req)))),
};
