import { z } from "zod";

export const updateDriverProfileSchema = z.object({
  city: z.string().max(100).optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
});

export const updateOnlineStatusSchema = z.object({
  online: z.boolean(),
});

export const reportLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const upsertVehicleSchema = z.object({
  category: z.enum(["bike", "car", "bus", "van"]),
  make: z.string().max(100).optional(),
  model: z.string().max(100).optional(),
  year: z.number().int().optional(),
  colour: z.string().max(50).optional(),
  plate: z.string().min(3).max(20),
  seats: z.number().int().optional(),
});

export const uploadDocumentSchema = z.object({
  fileUrl: z.string().url().optional(),
});

export const earningsPeriodQuerySchema = z.object({
  period: z.enum(["today", "yesterday", "week", "month"]).default("today"),
});

export const payoutQuoteSchema = z.object({
  amount: z.number().positive(),
});

export const requestPayoutSchema = z.object({
  amount: z.number().positive(),
});

export const payoutAccountSchema = z.object({
  bankName: z.string().min(2).max(100),
  bankCode: z.string().max(20).optional(),
  accountNumber: z.string().regex(/^\d{10}$/, "Account number must be 10 digits (NUBAN)"),
  accountName: z.string().min(2).max(150),
});

export const driverSettingsSchema = z
  .object({
    autoAcceptNearby: z.boolean(),
    longTripsOnly: z.boolean(),
    voiceNavigation: z.boolean(),
    readRequestsAloud: z.boolean(),
    shareTripsWithFamily: z.boolean(),
    navigationApp: z.enum(["Google Maps", "Waze", "Apple Maps"]),
  })
  .partial()
  .strict();

export const documentKeyParamSchema = z.object({
  key: z.string().regex(/^[a-z0-9_-]{2,40}$/i),
});
