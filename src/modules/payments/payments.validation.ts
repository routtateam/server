import { z } from "zod";

export const topUpSchema = z.object({
  amount: z.number().int().positive(), // minor units (kobo)
});

// TODO(security/PCI): raw PAN/CVV must not reach our servers - see the note on paymentsService.addCard.
export const addCardSchema = z.object({
  number: z.string().min(12).max(19),
  expiry: z.string().min(4).max(7),
  cvv: z.string().min(3).max(4),
  makeDefault: z.boolean().optional().default(false),
});

export const applyPromoSchema = z.object({
  code: z.string().min(2).max(40),
});
