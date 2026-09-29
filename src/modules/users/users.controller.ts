import { asyncHandler } from "@/common/utils/asyncHandler";
import { created, noContent, ok } from "@/common/utils/response";
import { usersService } from "./users.service";
import { UnauthorizedError } from "@/common/utils/errors";

function uid(req: any): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

export const usersController = {
  getMe: asyncHandler(async (req, res) => ok(res, await usersService.getProfile(uid(req)))),
  deleteMe: asyncHandler(async (req, res) => ok(res, await usersService.deleteAccount(uid(req)))),
  updateMe: asyncHandler(async (req, res) => ok(res, await usersService.updateProfile(uid(req), req.body))),

  listPlaces: asyncHandler(async (req, res) => ok(res, await usersService.listPlaces(uid(req)))),
  createPlace: asyncHandler(async (req, res) => created(res, await usersService.createPlace(uid(req), req.body))),
  deletePlace: asyncHandler(async (req, res) => {
    await usersService.deletePlace(uid(req), req.params.id);
    noContent(res);
  }),

  listEmergencyContacts: asyncHandler(async (req, res) => ok(res, await usersService.listEmergencyContacts(uid(req)))),
  createEmergencyContact: asyncHandler(async (req, res) => created(res, await usersService.createEmergencyContact(uid(req), req.body))),
  deleteEmergencyContact: asyncHandler(async (req, res) => {
    await usersService.deleteEmergencyContact(uid(req), req.params.id);
    noContent(res);
  }),
};
