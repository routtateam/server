import { z } from "zod";

const placeSchema = z.object({
  label: z.string().min(1).max(150),
  lat: z.number(),
  lng: z.number(),
});

export const quoteSchema = z.object({
  pickup: placeSchema,
  destination: placeSchema,
});

export const capacityQuerySchema = z.object({
  category: z.enum(["bus", "van"]),
});

export const requestTripSchema = z.object({
  pickup: placeSchema,
  destination: placeSchema,
  category: z.enum(["bike", "car", "bus", "van"]),
  fare: z.number().int().positive(),
  distanceKm: z.number().nonnegative(),
  paymentMethodId: z.string().uuid().optional(),
  promoCode: z.string().max(40).optional(),
});

export const cancelTripSchema = z.object({
  reason: z.string().max(255).optional(),
});

export const verifyPinSchema = z.object({
  pin: z.string().length(4),
});

export const rateTripSchema = z.object({
  rating: z.number().min(1).max(5),
  tags: z.array(z.string()).optional(),
  note: z.string().max(500).optional(),
});

export const tipSchema = z.object({
  amount: z.number().int().positive(),
});

export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const declineTripSchema = z.object({
  reason: z.string().max(255).optional(),
});

export const endEarlySchema = z.object({
  reason: z.string().max(255).optional(),
});

export const scheduleRideSchema = z.object({
  pickup: placeSchema,
  destination: placeSchema,
  category: z.enum(["bike", "car", "bus", "van"]),
  scheduledFor: z.string().datetime({ offset: true }), // ISO-8601
  fare: z.number().int().positive().optional(),
  paymentMethodId: z.string().uuid().optional(),
  promoCode: z.string().max(40).optional(),
  note: z.string().max(255).optional(),
});
