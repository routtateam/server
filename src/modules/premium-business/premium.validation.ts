import { z } from "zod";

export const createBookingSchema = z.object({
  vehicleId: z.string().uuid(),
  tierId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "startTime must be HH:mm"),
  occasion: z.string().max(150).optional(),
});

export const createVehicleSchema = z.object({
  name: z.string().min(1).max(150),
  type: z.string().max(100).optional(),
  brand: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  seats: z.number().int().optional(),
  year: z.number().int().min(1980).max(2100).optional(),
  plate: z.string().min(3).max(20).optional(),
  fromPrice: z.number().int().positive(),
  specs: z.array(z.object({ key: z.string(), value: z.string() })).optional().default([]),
  tiers: z
    .array(z.object({ label: z.string(), sub: z.string().optional(), price: z.number().int().positive() }))
    .min(1),
});

export const updateVehicleSchema = z.object({
  name: z.string().min(1).max(150).optional(),
  availability: z.enum(["available", "limited", "booked"]).optional(),
  fromPrice: z.number().int().positive().optional(),
  location: z.string().max(200).optional(),
  seats: z.number().int().positive().max(100).optional(),
  year: z.number().int().min(1980).max(2100).optional(),
  plate: z.string().min(3).max(20).optional(),
});

export const inviteTeamMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["manager", "staff"]).default("staff"),
});

const kobo = z.number().int().nonnegative();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM");

export const bookingListQuerySchema = z.object({
  tab: z.enum(["requests", "active", "upcoming", "completed", "all"]).optional(),
  status: z.enum(["requested", "confirmed", "active", "completed", "disputed", "cancelled", "declined", "expired"]).optional(),
});

export const declineBookingSchema = z.object({
  reason: z.string().trim().min(3).max(255),
});

/** Photos are URL strings (upload/storage of partner photos is a separate concern); only http(s) or same-origin paths. */
const photoUrl = z
  .string()
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u) || u.startsWith("/"), "photo must be an http(s) URL or a /path");

export const inspectionSchema = z.object({
  /** Checklist: item label -> "ok" | "issue", e.g. { "Exterior": "ok", "Interior": "issue" } */
  items: z.record(z.string().min(1).max(60), z.enum(["ok", "issue"])).refine((o) => Object.keys(o).length > 0 && Object.keys(o).length <= 30, "1-30 checklist items"),
  photos: z.array(photoUrl).max(10).optional().default([]),
  note: z.string().max(1000).optional(),
  /** Damage claim in kobo; capped server-side at the held deposit. */
  claimAmount: kobo.optional().default(0),
});

export const updateTiersSchema = z.object({
  tiers: z
    .array(z.object({ id: z.string().uuid(), price: z.number().int().positive(), label: z.string().min(1).max(100).optional(), sub: z.string().max(150).optional() }))
    .min(1)
    .max(10),
});

export const availabilityQuerySchema = z.object({ month });
export const setBlockedDaysSchema = z.object({ month, blockedDays: z.array(z.number().int().min(1).max(31)).max(31) });
export const blockDaySchema = z.object({ date: isoDate, reason: z.string().max(150).optional() });
export const dateParamSchema = z.object({ id: z.string().uuid(), date: isoDate });
export const uuidParamSchema = z.object({ id: z.string().uuid() });

export const partnerSettingsSchema = z.object({
  bookingMode: z.enum(["instant", "request"]).optional(),
});

export const payoutAccountSchema = z.object({
  bankName: z.string().min(2).max(100),
  bankCode: z.string().max(20).optional(),
  accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits (NUBAN)"),
  accountName: z.string().min(2).max(150),
});
