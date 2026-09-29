import { z } from "zod";

export const updateProfileSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  avatarUrl: z.string().url().optional(),
});

export const createPlaceSchema = z.object({
  label: z.string().min(1).max(150),
  subtitle: z.string().max(255).optional().default(""),
  lat: z.number(),
  lng: z.number(),
  kind: z.enum(["home", "work", "recent", "search", "saved"]),
});

export const createEmergencyContactSchema = z.object({
  name: z.string().min(1).max(150),
  relation: z.string().max(100).optional().default(""),
  phone: z.string().min(8).max(20),
  primary: z.boolean().optional(),
});
