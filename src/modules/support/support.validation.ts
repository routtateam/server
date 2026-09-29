import { z } from "zod";

export const createDisputeSchema = z.object({
  tripId: z.string().uuid().optional(),
  title: z.string().min(3).max(200),
  kind: z.enum(["fare", "route", "safety", "lost", "other"]).default("other"),
  description: z.string().min(3).max(2000),
  amount: z.number().int().nonnegative().optional(), // kobo
});

export const createTicketSchema = z.object({
  subject: z.string().min(3).max(200),
  body: z.string().min(3).max(4000),
  priority: z.enum(["low", "medium", "high"]).optional(),
  relatedTripId: z.string().uuid().optional(),
});

export const messageSchema = z.object({
  body: z.string().min(1).max(4000),
});

export const escalateSchema = z.object({
  note: z.string().max(500).optional(),
});
