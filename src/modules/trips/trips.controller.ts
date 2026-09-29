import { asyncHandler } from "@/common/utils/asyncHandler";
import { created, ok } from "@/common/utils/response";
import { tripsService } from "./trips.service";
import { UnauthorizedError } from "@/common/utils/errors";
import { parsePagination } from "@/common/utils/pagination";
import { scheduledRidesService } from "./trips.scheduled";

function requireUser(req: any) {
  if (!req.user) throw new UnauthorizedError();
  return req.user as { id: string; userType: string; permissions: string[] };
}

export const tripsController = {
  getQuotes: asyncHandler(async (req, res) => ok(res, await tripsService.getQuotes(req.body.pickup, req.body.destination))),
  getCapacityOptions: asyncHandler(async (req, res) => ok(res, await tripsService.getCapacityOptions(req.query.category as any))),

  requestTrip: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    created(res, await tripsService.requestTrip(user.id, req.body));
  }),

  getTrip: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    ok(res, await tripsService.getTrip(req.params.id, user.id, user.userType, user.permissions));
  }),

  listIncoming: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    ok(res, await tripsService.listIncomingForDriver(user.id));
  }),

  accept: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    ok(res, await tripsService.acceptTrip(req.params.id, user.id));
  }),

  decline: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    ok(res, await tripsService.declineTrip(req.params.id, user.id, req.body?.reason));
  }),

  verifyPin: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    ok(res, await tripsService.verifyArrivalPin(req.params.id, user.id, req.body.pin));
  }),

  complete: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    ok(res, await tripsService.completeTrip(req.params.id, user.id, user.userType));
  }),

  endEarly: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    ok(res, await tripsService.endTripEarly(req.params.id, user.id, req.body?.reason));
  }),

  scheduledCreate: asyncHandler(async (req, res) => created(res, await scheduledRidesService.create(requireUser(req).id, req.body))),
  scheduledList: asyncHandler(async (req, res) => ok(res, await scheduledRidesService.list(requireUser(req).id))),
  scheduledCancel: asyncHandler(async (req, res) => ok(res, await scheduledRidesService.cancel(requireUser(req).id, req.params.id))),

  cancel: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    ok(res, await tripsService.cancelTrip(req.params.id, user.id, req.body.reason));
  }),

  rate: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    ok(res, await tripsService.rateTrip(req.params.id, user.id, req.body.rating));
  }),

  tip: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    ok(res, await tripsService.sendTip(req.params.id, user.id, req.body.amount));
  }),

  history: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const { page, pageSize } = parsePagination(req.query as any);
    ok(res, await tripsService.historyForCommuter(user.id, page, pageSize));
  }),

  today: asyncHandler(async (req, res) => {
    const user = requireUser(req);
    ok(res, await tripsService.todayForDriver(user.id));
  }),
};
