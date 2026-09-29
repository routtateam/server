import { asyncHandler } from "@/common/utils/asyncHandler";
import { created, ok } from "@/common/utils/response";
import { adminService } from "./admin.service";
import { adminSupportService } from "@/modules/support/support.service";
import { parsePagination } from "@/common/utils/pagination";
import { UnauthorizedError } from "@/common/utils/errors";

function requireAdmin(req: any) {
  if (!req.user) throw new UnauthorizedError();
  return req.user as { id: string };
}

export const adminController = {
  overview: asyncHandler(async (_req, res) => ok(res, await adminService.overview())),

  listTransporters: asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePagination(req.query as any);
    ok(res, await adminService.listTransporters(page, pageSize));
  }),
  listCommuters: asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePagination(req.query as any);
    ok(res, await adminService.listCommuters(page, pageSize));
  }),

  listTrips: asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePagination(req.query as any);
    ok(res, await adminService.listTrips(page, pageSize, req.query.status as string | undefined));
  }),
  reassignTrip: asyncHandler(async (req, res) => ok(res, await adminService.reassignTrip(req.params.id, req.body.driverId))),

  listVerifications: asyncHandler(async (_req, res) => ok(res, await adminService.listVerifications())),
  approveApplicant: asyncHandler(async (req, res) => ok(res, await adminService.approveApplicant(req.params.id))),
  rejectApplicant: asyncHandler(async (req, res) => ok(res, await adminService.rejectApplicant(req.params.id))),
  requestClearerDocument: asyncHandler(async (req, res) =>
    ok(res, await adminService.requestClearerDocument(req.body.documentId, req.params.id))
  ),

  listDisputes: asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePagination(req.query as any);
    ok(res, await adminService.listDisputes(page, pageSize, req.query.status as string | undefined));
  }),
  resolveDispute: asyncHandler(async (req, res) => ok(res, await adminService.resolveDispute(req.params.id, req.body.resolutionNote))),

  disputeDetail: asyncHandler(async (req, res) => ok(res, await adminSupportService.disputeDetail(req.params.id))),
  replyDispute: asyncHandler(async (req, res) => created(res, await adminSupportService.replyDispute(requireAdmin(req).id, req.params.id, req.body.body))),
  escalateDispute: asyncHandler(async (req, res) => ok(res, await adminSupportService.escalateDispute(req.params.id, req.body?.note))),
  ticketDetail: asyncHandler(async (req, res) => ok(res, await adminSupportService.ticketDetail(req.params.id))),
  replyTicket: asyncHandler(async (req, res) => created(res, await adminSupportService.replyTicket(requireAdmin(req).id, req.params.id, req.body.body))),
  escalateTicket: asyncHandler(async (req, res) => ok(res, await adminSupportService.escalateTicket(req.params.id, req.body?.note))),

  listSupportTickets: asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePagination(req.query as any);
    ok(res, await adminService.listSupportTickets(page, pageSize));
  }),
  updateSupportTicket: asyncHandler(async (req, res) => ok(res, await adminService.updateSupportTicket(req.params.id, req.body))),

  getFeeCards: asyncHandler(async (_req, res) => ok(res, await adminService.getFeeCards())),
  saveRates: asyncHandler(async (req, res) => ok(res, await adminService.saveRates(req.body.rules))),

  listPromotions: asyncHandler(async (_req, res) => ok(res, await adminService.listPromotions())),
  createPromotion: asyncHandler(async (req, res) => created(res, await adminService.createPromotion(req.body))),
  updatePromotion: asyncHandler(async (req, res) => ok(res, await adminService.updatePromotion(req.params.code, req.body))),

  listPayouts: asyncHandler(async (req, res) => {
    const { page, pageSize } = parsePagination(req.query as any);
    ok(res, await adminService.listPayouts(page, pageSize, req.query.status as string | undefined));
  }),
  approvePayout: asyncHandler(async (req, res) => ok(res, await adminService.approvePayout(req.params.id))),
  approveAllPending: asyncHandler(async (_req, res) => ok(res, await adminService.approveAllPending())),

  listBusinesses: asyncHandler(async (_req, res) => ok(res, await adminService.listBusinesses())),
  actOnBusiness: asyncHandler(async (req, res) => ok(res, await adminService.actOnBusiness(req.params.id, req.body.action))),
  listAllPremiumVehicles: asyncHandler(async (_req, res) => ok(res, await adminService.listAllPremiumVehicles())),
  actOnPremiumVehicle: asyncHandler(async (req, res) => ok(res, await adminService.actOnPremiumVehicle(req.params.id, req.body.action))),
  listAllPremiumBookings: asyncHandler(async (_req, res) => ok(res, await adminService.listAllPremiumBookings())),
  listProtectionDeposits: asyncHandler(async (_req, res) => ok(res, await adminService.listProtectionDeposits())),
  actOnDeposit: asyncHandler(async (req, res) => ok(res, await adminService.actOnDeposit(req.params.id, req.body.action))),
  listSettlements: asyncHandler(async (_req, res) => ok(res, await adminService.listSettlements())),
  runSettlement: asyncHandler(async (_req, res) => ok(res, await adminService.runSettlement())),
  getPremiumRules: asyncHandler(async (_req, res) => ok(res, await adminService.getPremiumRules())),
  savePremiumRules: asyncHandler(async (req, res) => ok(res, await adminService.savePremiumRules(req.body.rules))),

  listAdmins: asyncHandler(async (_req, res) => ok(res, await adminService.listAdmins())),
  listRoles: asyncHandler(async (_req, res) => ok(res, await adminService.listRoles())),
  inviteAdmin: asyncHandler(async (req, res) => {
    const admin = requireAdmin(req);
    ok(res, await adminService.inviteAdmin(req.body.email, req.body.roleName, admin.id));
  }),
};
