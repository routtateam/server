import { z } from "zod";

export const sendOtpSchema = z.object({
  phone: z.string().min(8).max(20),
});

export const verifyOtpSchema = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().min(4).max(8),
});

export const commuterSignupSchema = z.object({
  otpToken: z.string(),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  referralCode: z.string().max(32).optional(),
});

export const commuterLoginSchema = z.object({
  otpToken: z.string(),
});

export const driverLoginSchema = z.object({
  otpToken: z.string(),
});

export const driverLicenceLoginSchema = z.object({
  licenseNumber: z.string().min(3),
  phone: z.string().min(8).max(20),
});

export const staffLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const staffMfaVerifySchema = z.object({
  staffToken: z.string(),
  code: z.string().min(4).max(8),
});

export const staffForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const businessLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

/** Public driver application (no auth). Creates a pending applicant; verification happens via OTP + admin review. */
export const driverApplySchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  phone: z.string().min(8).max(20),
  email: z.string().email().optional(),
  city: z.string().max(100).optional(),
  licenseNumber: z.string().min(3).max(100).optional(),
  vehicle: z
    .object({
      category: z.enum(["bike", "car", "bus", "van"]),
      make: z.string().max(100).optional(),
      model: z.string().max(100).optional(),
      year: z.number().int().min(1980).max(2100).optional(),
      colour: z.string().max(50).optional(),
      plate: z.string().min(3).max(20),
      seats: z.number().int().positive().max(100).optional(),
    })
    .optional(),
});
