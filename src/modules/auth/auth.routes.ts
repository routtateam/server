import { Router } from "express";
import { authController } from "./auth.controller";
import { validate } from "@/common/middleware/validate";
import { requireAuth } from "@/common/middleware/auth";
import { rateLimit } from "@/common/middleware/rateLimit";
import * as v from "./auth.validation";

export const authRouter = Router();

// Commuter
authRouter.post("/commuter/otp/send", validate(v.sendOtpSchema), authController.sendCommuterOtp);
authRouter.post("/commuter/otp/verify", validate(v.verifyOtpSchema), authController.verifyCommuterOtp);
authRouter.post("/commuter/signup", validate(v.commuterSignupSchema), authController.commuterSignup);
authRouter.post("/commuter/login", validate(v.commuterLoginSchema), authController.commuterLogin);

// Driver / transporter
// Public (no auth) driver application; rate-limited because it triggers an SMS OTP.
authRouter.post("/driver/apply", rateLimit({ windowMs: 60 * 60_000, max: 10 }), validate(v.driverApplySchema), authController.driverApply);
authRouter.post("/driver/otp/send", validate(v.sendOtpSchema), authController.sendDriverOtp);
authRouter.post("/driver/otp/verify", validate(v.verifyOtpSchema), authController.verifyDriverOtp);
authRouter.post("/driver/login", validate(v.driverLoginSchema), authController.driverLogin);
authRouter.post("/driver/login-licence", validate(v.driverLicenceLoginSchema), authController.driverLoginWithLicence);

// Staff (admin dashboard)
authRouter.post("/staff/login", validate(v.staffLoginSchema), authController.staffLogin);
authRouter.post("/staff/sso", authController.staffSso);
authRouter.post("/staff/mfa/verify", validate(v.staffMfaVerifySchema), authController.staffVerifyMfa);
authRouter.post("/staff/password/forgot", validate(v.staffForgotPasswordSchema), authController.staffForgotPassword);

// Premium-business partner
authRouter.post("/business/login", validate(v.businessLoginSchema), authController.businessLogin);

// Shared
authRouter.post("/refresh", validate(v.refreshTokenSchema), authController.refresh);
authRouter.post("/logout", requireAuth, authController.logout);
authRouter.get("/me", requireAuth, authController.me);
