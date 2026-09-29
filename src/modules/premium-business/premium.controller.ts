import { asyncHandler } from "@/common/utils/asyncHandler";
import { created, ok } from "@/common/utils/response";
import { premiumService } from "./premium.service";
import { partnerService } from "./partner.service";
import { UnauthorizedError } from "@/common/utils/errors";

function uid(req: any): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

export const premiumController = {
  // Commuter marketplace
  listVehicles: asyncHandler(async (_req, res) => ok(res, await premiumService.listVehicles())),
  getFeatured: asyncHandler(async (_req, res) => ok(res, await premiumService.getFeatured())),
  getVehicle: asyncHandler(async (req, res) => ok(res, await premiumService.getVehicle(req.params.id))),
  getBusiness: asyncHandler(async (req, res) => ok(res, await premiumService.getBusiness(req.params.id))),
  createBooking: asyncHandler(async (req, res) => created(res, await premiumService.createBooking(uid(req), req.body))),
  getActiveBooking: asyncHandler(async (req, res) => ok(res, await premiumService.getActiveBooking(uid(req)))),
  getBookingHistory: asyncHandler(async (req, res) => ok(res, await premiumService.getBookingHistory(uid(req)))),

  // Business partner management
  listMyVehicles: asyncHandler(async (req, res) => {
    const business = await premiumService.requireBusinessForUser(uid(req));
    ok(res, await premiumService.listVehiclesForBusiness(business.id));
  }),
  createMyVehicle: asyncHandler(async (req, res) => {
    const business = await premiumService.requireBusinessForUser(uid(req));
    created(res, await premiumService.createVehicleForBusiness(business.id, req.body));
  }),
  updateMyVehicle: asyncHandler(async (req, res) => {
    const business = await premiumService.requireBusinessForUser(uid(req));
    ok(res, await premiumService.updateVehicleForBusiness(business.id, req.params.id, req.body));
  }),
  listMyBookings: asyncHandler(async (req, res) => {
    const business = await premiumService.requireBusinessForUser(uid(req));
    ok(res, await premiumService.bookingsForBusiness(business.id));
  }),
  listMyTeam: asyncHandler(async (req, res) => {
    const business = await premiumService.requireBusinessForUser(uid(req));
    ok(res, await premiumService.teamForBusiness(business.id));
  }),
  inviteMyTeamMember: asyncHandler(async (req, res) => {
    const business = await premiumService.requireBusinessForUser(uid(req));
    created(res, await premiumService.inviteTeamMember(business.id, req.body.email, req.body.role));
  }),

  // ---- Partner workflow (see partner.service.ts) ----
  listBookings: asyncHandler(async (req, res) => {
    const ctx = await partnerService.contextForUser(uid(req));
    ok(res, await partnerService.listBookings(ctx, req.query as any));
  }),
  listRequests: asyncHandler(async (req, res) => ok(res, await partnerService.listRequests(await partnerService.contextForUser(uid(req))))),
  getBooking: asyncHandler(async (req, res) => ok(res, await partnerService.getBooking(await partnerService.contextForUser(uid(req)), req.params.id))),
  bookingTimeline: asyncHandler(async (req, res) => ok(res, await partnerService.timeline(await partnerService.contextForUser(uid(req)), req.params.id))),
  acceptBooking: asyncHandler(async (req, res) => ok(res, await partnerService.accept(await partnerService.contextForUser(uid(req)), req.params.id))),
  declineBooking: asyncHandler(async (req, res) => ok(res, await partnerService.decline(await partnerService.contextForUser(uid(req)), req.params.id, req.body.reason))),
  startBooking: asyncHandler(async (req, res) => ok(res, await partnerService.start(await partnerService.contextForUser(uid(req)), req.params.id))),
  submitInspection: asyncHandler(async (req, res) => created(res, await partnerService.submitInspection(await partnerService.contextForUser(uid(req)), req.params.id, req.body))),

  getMyVehicle: asyncHandler(async (req, res) => {
    const ctx = await partnerService.contextForUser(uid(req));
    ok(res, await premiumService.getVehicleForBusiness(ctx.businessId, req.params.id));
  }),
  updateTiers: asyncHandler(async (req, res) => ok(res, await partnerService.updateTiers(await partnerService.contextForUser(uid(req)), req.params.id, req.body.tiers))),
  getAvailability: asyncHandler(async (req, res) => ok(res, await partnerService.getAvailability(await partnerService.contextForUser(uid(req)), req.params.id, (req.query as any).month))),
  setBlockedDays: asyncHandler(async (req, res) =>
    ok(res, await partnerService.setBlockedDays(await partnerService.contextForUser(uid(req)), req.params.id, req.body.month, req.body.blockedDays))
  ),
  blockDay: asyncHandler(async (req, res) => ok(res, await partnerService.blockDay(await partnerService.contextForUser(uid(req)), req.params.id, req.body.date, req.body.reason))),
  unblockDay: asyncHandler(async (req, res) => ok(res, await partnerService.unblockDay(await partnerService.contextForUser(uid(req)), req.params.id, req.params.date))),

  getSettings: asyncHandler(async (req, res) => ok(res, partnerService.getSettings(await partnerService.contextForUser(uid(req))))),
  updateSettings: asyncHandler(async (req, res) => ok(res, await partnerService.updateSettings(await partnerService.contextForUser(uid(req)), req.body))),
  earningsSummary: asyncHandler(async (req, res) => ok(res, await partnerService.earningsSummary(await partnerService.contextForUser(uid(req))))),
  payouts: asyncHandler(async (req, res) => ok(res, await partnerService.payouts(await partnerService.contextForUser(uid(req))))),
  getPayoutAccount: asyncHandler(async (req, res) => ok(res, partnerService.getPayoutAccount(await partnerService.contextForUser(uid(req))))),
  setPayoutAccount: asyncHandler(async (req, res) => ok(res, await partnerService.setPayoutAccount(await partnerService.contextForUser(uid(req)), req.body))),
};
