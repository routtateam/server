import type { Request, Response } from "express";
import { asyncHandler } from "@/common/utils/asyncHandler";
import { ok, created } from "@/common/utils/response";
import { authService } from "./auth.service";
import { UnauthorizedError } from "@/common/utils/errors";

export const authController = {
  sendCommuterOtp: asyncHandler(async (req, res) => ok(res, await authService.sendCommuterOtp(req.body.phone))),
  verifyCommuterOtp: asyncHandler(async (req, res) => ok(res, await authService.verifyCommuterOtp(req.body.phone, req.body.code))),
  commuterSignup: asyncHandler(async (req, res) => created(res, await authService.commuterSignup(req.body.otpToken, req.body))),
  commuterLogin: asyncHandler(async (req, res) => ok(res, await authService.commuterLogin(req.body.otpToken))),

  driverApply: asyncHandler(async (req, res) => created(res, await authService.driverApply(req.body))),
  sendDriverOtp: asyncHandler(async (req, res) => ok(res, await authService.sendDriverOtp(req.body.phone))),
  verifyDriverOtp: asyncHandler(async (req, res) => ok(res, await authService.verifyDriverOtp(req.body.phone, req.body.code))),
  driverLogin: asyncHandler(async (req, res) => ok(res, await authService.driverLogin(req.body.otpToken))),
  driverLoginWithLicence: asyncHandler(async (req, res) =>
    ok(res, await authService.driverLoginWithLicence(req.body.licenseNumber, req.body.phone))
  ),

  staffLogin: asyncHandler(async (req, res) => ok(res, await authService.staffLogin(req.body.email, req.body.password))),
  staffSso: asyncHandler(async (req, res) => ok(res, await authService.staffSsoLogin(req.body.email ?? "funke@routta.ng"))),
  staffVerifyMfa: asyncHandler(async (req, res) => ok(res, await authService.staffVerifyMfa(req.body.staffToken, req.body.code))),
  staffForgotPassword: asyncHandler(async (req, res) => ok(res, await authService.staffForgotPassword(req.body.email))),

  businessLogin: asyncHandler(async (req, res) => ok(res, await authService.businessLogin(req.body.email, req.body.password))),

  refresh: asyncHandler(async (req, res) => ok(res, await authService.refresh(req.body.refreshToken))),

  logout: asyncHandler(async (_req, res) => {
    // JWTs are stateless here; logout is a client-side token discard.
    // A real deployment could add a Redis-backed denylist keyed by jti.
    res.status(204).send();
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new UnauthorizedError();
    const row = await authService.me(req.user.id);
    ok(res, { id: row.id, userType: row.user_type, email: row.email, phone: row.phone, permissions: req.user.permissions });
  }),
};
