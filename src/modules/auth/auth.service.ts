import jwt from "jsonwebtoken";
import { authRepository } from "./auth.repository";
import { env } from "@/config/env";
import { logger } from "@/common/utils/logger";
import { UnauthorizedError, ValidationError, ConflictError, NotFoundError } from "@/common/utils/errors";
import { hashOtp, compareOtp, hashPassword, comparePassword } from "@/common/utils/password";
import { signAccessToken, signRefreshToken } from "./jwt";
import { termii } from "@/integrations/termii";
import { resendAdapter } from "@/integrations/resend";
import { eventBus, DomainEvents } from "@/events/eventBus";
import { dispatchNotification } from "@/jobs/dispatch";
import type { AuthSessionDTO, CommuterProfileDTO, DriverDTO, StaffSessionDTO, UserRow } from "./auth.types";
import type { AuthenticatedUser } from "@/common/types/express";

function generateOtpCode(): string {
  const digits = "0123456789";
  let code = "";
  for (let i = 0; i < env.otp.length; i++) code += digits[Math.floor(Math.random() * 10)];
  return code;
}

function initials(first?: string | null, last?: string | null): string {
  return `${(first ?? "?")[0] ?? ""}${(last ?? "?")[0] ?? ""}`.toUpperCase();
}

function toCommuterProfile(row: UserRow, ridesCount: number): CommuterProfileDTO {
  return {
    id: row.id,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    email: row.email ?? "",
    emailVerified: row.email_verified,
    phone: row.phone ?? "",
    phoneVerified: row.phone_verified,
    avatarUrl: row.avatar_url ?? undefined,
    rating: Number(row.rating),
    memberSince: String(new Date(row.created_at).getFullYear()),
    ridesCount,
    referralCode: row.referral_code ?? "",
  };
}

interface OtpTokenPayload {
  identifier: string;
  purpose: string;
  scope: "otp_verified";
}

function signOtpToken(payload: OtpTokenPayload): string {
  return jwt.sign(payload, env.jwt.accessSecret, { expiresIn: "10m" });
}

function verifyOtpToken(token: string): OtpTokenPayload {
  try {
    const decoded = jwt.verify(token, env.jwt.accessSecret) as OtpTokenPayload;
    if (decoded.scope !== "otp_verified") throw new Error("bad scope");
    return decoded;
  } catch {
    throw new UnauthorizedError("OTP verification has expired — please verify again.");
  }
}

async function buildAuthenticatedUser(row: UserRow): Promise<AuthenticatedUser> {
  const base: AuthenticatedUser = { id: row.id, userType: row.user_type, email: row.email ?? undefined, phone: row.phone ?? undefined, permissions: [] };
  if (row.user_type === "admin") {
    base.permissions = await authRepository.getPermissionsForUser(row.id);
  }
  if (row.user_type === "business") {
    const membership = await authRepository.getBusinessTeamMembership(row.id);
    if (membership) {
      base.businessId = membership.business_id;
      base.businessRole = membership.role;
    }
  }
  return base;
}

function issueTokens(user: AuthenticatedUser) {
  return {
    token: signAccessToken(user),
    refreshToken: signRefreshToken({ id: user.id, userType: user.userType }),
  };
}

export const authService = {
  // ---- Commuter ----

  async sendCommuterOtp(phone: string) {
    return sendPhoneOtp(phone, "commuter_login");
  },

  async verifyCommuterOtp(phone: string, code: string) {
    await verifyPhoneOtp(phone, code, "commuter_login");
    const existing = await authRepository.findByPhone(phone);
    return { verified: true, isNewUser: !existing, otpToken: signOtpToken({ identifier: phone, purpose: "commuter_login", scope: "otp_verified" }) };
  },

  async commuterSignup(otpToken: string, input: { firstName: string; lastName: string; email: string; referralCode?: string }): Promise<AuthSessionDTO> {
    const { identifier: phone } = verifyOtpToken(otpToken);
    const existing = await authRepository.findByPhone(phone);
    if (existing) throw new ConflictError("An account already exists for this phone number.");

    const row = await authRepository.createUser({
      userType: "commuter",
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone,
      phoneVerified: true,
      referralCode: `${input.firstName.slice(0, 4).toUpperCase()}${Math.floor(Math.random() * 90 + 10)}`,
    });
    await authRepository.ensureWallet(row.id);
    eventBus.publish(DomainEvents.UserRegistered, { userId: row.id, userType: "commuter" });
    await dispatchNotification({ userId: row.id, title: "Welcome to Routta", body: "Your account is ready. Take your first ride!" });

    const user = await buildAuthenticatedUser(row);
    return { ...issueTokens(user), profile: toCommuterProfile(row, 0) };
  },

  async commuterLogin(otpToken: string): Promise<AuthSessionDTO> {
    const { identifier: phone } = verifyOtpToken(otpToken);
    const row = await authRepository.findByPhone(phone);
    if (!row) throw new NotFoundError("No account found for this phone number — please sign up.");
    await authRepository.touchLastActive(row.id);
    const user = await buildAuthenticatedUser(row);
    return { ...issueTokens(user), profile: toCommuterProfile(row, 0) };
  },

  // ---- Driver ----

  async sendDriverOtp(phone: string) {
    return sendPhoneOtp(phone, "driver_login");
  },

  async verifyDriverOtp(phone: string, code: string) {
    await verifyPhoneOtp(phone, code, "driver_login");
    const existing = await authRepository.findByPhone(phone);
    return { verified: true, isNewUser: !existing, otpToken: signOtpToken({ identifier: phone, purpose: "driver_login", scope: "otp_verified" }) };
  },

  /**
   * Public driver application. Creates a pending applicant (users.status = "pending", driver_profiles.verified = false,
   * optional draft vehicle) and sends the same login OTP as /auth/driver/otp/send. The applicant then calls
   * /auth/driver/otp/verify + /auth/driver/login as usual and uploads documents; an admin approves from the
   * verifications queue, which activates the account. Applicants are not matched to trips until approved.
   */
  async driverApply(input: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    city?: string;
    licenseNumber?: string;
    vehicle?: { category: string; make?: string; model?: string; year?: number; colour?: string; plate: string; seats?: number };
  }) {
    if (await authRepository.findByPhone(input.phone)) {
      throw new ConflictError("An account already exists for this phone number. Log in instead.");
    }
    if (input.email && (await authRepository.findByEmail(input.email))) {
      throw new ConflictError("An account already exists for this email address.");
    }
    if (input.vehicle && (await authRepository.vehicleByPlate(input.vehicle.plate))) {
      throw new ConflictError("A vehicle with this plate number is already registered.");
    }
    const applicant = await authRepository.createDriverApplicant(input);
    eventBus.publish(DomainEvents.UserRegistered, { userId: applicant.id, userType: "driver" });
    const otp = await sendPhoneOtp(input.phone, "driver_login");
    return { applicationId: applicant.id, status: "pending" as const, otp };
  },

  async driverLogin(otpToken: string): Promise<{ driver: DriverDTO; token: string; refreshToken: string }> {
    const { identifier: phone } = verifyOtpToken(otpToken);
    let row = await authRepository.findByPhone(phone);
    if (!row) {
      row = await authRepository.createUser({ userType: "driver", phone, phoneVerified: true, firstName: "New", lastName: "Driver" });
      await authRepository.ensureWallet(row.id);
      await authRepository.ensureDriverProfile(row.id);
      eventBus.publish(DomainEvents.UserRegistered, { userId: row.id, userType: "driver" });
    }
    const profile = await authRepository.ensureDriverProfile(row.id);
    const user = await buildAuthenticatedUser(row);
    return { ...issueTokens(user), driver: toDriverDto(row, profile) };
  },

  async driverLoginWithLicence(licenseNumber: string, phone: string): Promise<{ driver: DriverDTO; token: string; refreshToken: string }> {
    const row = await authRepository.findByPhone(phone);
    if (!row) throw new NotFoundError("No driver account found for this phone number.");
    const profile = await authRepository.ensureDriverProfile(row.id);
    if (profile.license_number && profile.license_number !== licenseNumber) {
      throw new UnauthorizedError("Licence number does not match our records.");
    }
    const user = await buildAuthenticatedUser(row);
    return { ...issueTokens(user), driver: toDriverDto(row, profile) };
  },

  // ---- Staff (admin) ----

  async staffLogin(email: string, password: string) {
    const row = await authRepository.findByEmail(email);
    if (!row || row.user_type !== "admin" || !row.password_hash) {
      throw new UnauthorizedError("Incorrect work email or password.");
    }
    const valid = await comparePassword(password, row.password_hash);
    if (!valid) throw new UnauthorizedError("Incorrect work email or password.");

    const code = generateOtpCode();
    const codeHash = await hashOtp(code);
    await authRepository.createOtp(row.email!, "email", "staff_mfa", codeHash, env.otp.ttlSeconds);
    await resendAdapter.sendOtpEmail(row.email!, code);

    return { mfaRequired: true, staffToken: signOtpToken({ identifier: row.email!, purpose: "staff_mfa_pending", scope: "otp_verified" }) };
  },

  async staffSsoLogin(email: string) {
    // Placeholder SSO path — real implementation needs a real IdP integration.
    const row = await authRepository.findByEmail(email);
    if (!row || row.user_type !== "admin") throw new UnauthorizedError("No staff account for this identity provider response.");
    const code = generateOtpCode();
    const codeHash = await hashOtp(code);
    await authRepository.createOtp(row.email!, "email", "staff_mfa", codeHash, env.otp.ttlSeconds);
    await resendAdapter.sendOtpEmail(row.email!, code);
    return { mfaRequired: true, staffToken: signOtpToken({ identifier: row.email!, purpose: "staff_mfa_pending", scope: "otp_verified" }) };
  },

  async staffVerifyMfa(staffToken: string, code: string): Promise<StaffSessionDTO & { token: string; refreshToken: string }> {
    const { identifier: email } = verifyOtpToken(staffToken);
    const otp = await authRepository.latestActiveOtp(email, "staff_mfa");
    if (!otp) throw new ValidationError("Enter the full 6-digit code.");
    const valid = await compareOtp(code, otp.code_hash);
    if (!valid) {
      await authRepository.incrementOtpAttempts(otp.id);
      throw new ValidationError("Enter the full 6-digit code.");
    }
    await authRepository.consumeOtp(otp.id);

    const row = await authRepository.findByEmail(email);
    if (!row) throw new NotFoundError("Staff account not found.");
    const role = await authRepository.getRoleForUser(row.id);
    const permissions = await authRepository.getPermissionsForUser(row.id);
    const user = await buildAuthenticatedUser(row);

    return {
      ...issueTokens(user),
      id: row.id,
      name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
      email: row.email ?? "",
      initials: initials(row.first_name, row.last_name),
      role: role?.name ?? "Support admin",
      title: role?.name ?? "Support admin",
      permissions,
    };
  },

  async staffForgotPassword(email: string) {
    const row = await authRepository.findByEmail(email);
    if (row) {
      await resendAdapter.sendEmail({
        to: email,
        subject: "Reset your Routta admin password",
        html: "<p>A password reset was requested for your Routta admin account. (Sandbox stub — no real email delivered.)</p>",
      });
    }
    // Always respond the same way whether or not the account exists, to avoid user enumeration.
    return { sent: true, email };
  },

  // ---- Business partner ----

  async businessLogin(email: string, password: string) {
    const row = await authRepository.findByEmail(email);
    if (!row || row.user_type !== "business" || !row.password_hash) {
      throw new UnauthorizedError("Incorrect work email or password.");
    }
    const valid = await comparePassword(password, row.password_hash);
    if (!valid) throw new UnauthorizedError("Incorrect work email or password.");

    const membership = await authRepository.getBusinessTeamMembership(row.id);
    const business = membership ? await authRepository.getBusinessForOwner(row.id) : undefined;
    const user = await buildAuthenticatedUser(row);
    return {
      ...issueTokens(user),
      profile: {
        id: row.id,
        name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim(),
        email: row.email ?? "",
        businessId: membership?.business_id,
        businessName: business?.name,
        role: membership?.role ?? "staff",
      },
    };
  },

  // ---- Shared ----

  async refresh(refreshToken: string) {
    let decoded: { id: string; userType: AuthenticatedUser["userType"] };
    try {
      decoded = jwt.verify(refreshToken, env.jwt.refreshSecret) as typeof decoded;
    } catch {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }
    const row = await authRepository.findById(decoded.id);
    if (!row) throw new UnauthorizedError("Account no longer exists");
    const user = await buildAuthenticatedUser(row);
    return issueTokens(user);
  },

  async me(userId: string) {
    const row = await authRepository.findById(userId);
    if (!row) throw new NotFoundError("Account not found");
    return row;
  },

  async createOtpForPasswordHash(password: string) {
    return hashPassword(password);
  },
};

const isTermiiLive = () => env.termii.liveMode && !env.termii.apiKey.startsWith("TL_TEST");

async function sendPhoneOtp(phone: string, purpose: string) {
  const code = generateOtpCode();
  const codeHash = await hashOtp(code);
  await authRepository.createOtp(phone, "sms", purpose, codeHash, env.otp.ttlSeconds);
  await termii.sendOtp({
    message_type: "NUMERIC",
    to: phone,
    channel: "generic",
    pin_attempts: 3,
    pin_time_to_live: Math.ceil(env.otp.ttlSeconds / 60),
    pin_length: env.otp.length,
    pin_placeholder: "< 1234 >",
    message_text: `Your Routta verification code is < 1234 >. It expires in ${Math.ceil(env.otp.ttlSeconds / 60)} minutes.`,
    pin_type: "NUMERIC",
  });
  if (!isTermiiLive()) {
    // No real SMS provider configured — this code was never actually delivered to the phone.
    // Log it so it's visible without a frontend that surfaces devOtpHint.
    logger.warn({ phone, purpose, code }, "[OTP] not sent via SMS (Termii not live) — code for manual testing");
  }
  return { sent: true, phone, devOtpHint: env.isProduction ? undefined : code };
}

async function verifyPhoneOtp(phone: string, code: string, purpose: string) {
  const otp = await authRepository.latestActiveOtp(phone, purpose);
  if (!otp) throw new ValidationError("Enter the 6-digit code sent to your phone.");
  if (otp.attempts >= 5) throw new UnauthorizedError("Too many attempts — request a new code.");
  const valid = await compareOtp(code, otp.code_hash);
  if (!valid) {
    await authRepository.incrementOtpAttempts(otp.id);
    throw new ValidationError("Enter the 6-digit code sent to your phone.");
  }
  await authRepository.consumeOtp(otp.id);
}

function toDriverDto(row: UserRow, profile: any): DriverDTO {
  return {
    id: row.id,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    city: profile?.city ?? "",
    initials: initials(row.first_name, row.last_name),
    rating: Number(row.rating),
    totalTrips: profile?.total_trips ?? 0,
    totalEarned: profile?.total_earned ?? 0,
    memberSince: profile?.member_since_year ?? new Date(row.created_at).getFullYear(),
    verified: profile?.verified ?? false,
  };
}
