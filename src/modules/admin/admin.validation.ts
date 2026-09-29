import { z } from "zod";

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  status: z.string().optional(),
});

export const reassignTripSchema = z.object({
  driverId: z.string().uuid(),
});

export const requestClearerDocumentSchema = z.object({
  documentId: z.string().uuid(),
});

export const resolveDisputeSchema = z.object({
  resolutionNote: z.string().max(500).optional(),
});

export const supportTicketUpdateSchema = z.object({
  status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
  assigneeId: z.string().uuid().optional(),
});

export const savePricingSchema = z.object({
  rules: z.array(
    z.object({
      category: z.enum(["bike", "car", "bus", "van"]),
      feePercent: z.number().min(0).max(100),
      ratePerKm: z.number().int().nonnegative(),
    })
  ),
});

export const createPromotionSchema = z.object({
  code: z.string().min(2).max(40),
  description: z.string().max(255).optional(),
  discountType: z.enum(["fixed", "percent"]),
  discountValue: z.number().positive(),
  categoryScope: z.enum(["bike", "car", "bus", "van", "all"]).default("all"),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  usageLimit: z.number().int().positive().optional(),
});

export const updatePromotionSchema = z.object({
  status: z.enum(["active", "scheduled", "expired", "disabled"]).optional(),
  description: z.string().max(255).optional(),
});

export const premiumActionSchema = z.object({
  action: z.enum(["approve", "reject", "suspend", "request-changes"]),
});

export const depositActionSchema = z.object({
  action: z.enum(["refund", "deduct"]),
});

export const premiumRulesSchema = z.object({
  rules: z.array(z.object({ key: z.string(), value: z.number() })),
});

export const inviteAdminSchema = z.object({
  email: z.string().email(),
  roleName: z.enum(["Super admin", "Trip admin", "Support admin", "Finance admin"]),
});
