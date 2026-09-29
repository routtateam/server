import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "@/common/middleware/auth";
import { validate } from "@/common/middleware/validate";
import { asyncHandler } from "@/common/utils/asyncHandler";
import { ok } from "@/common/utils/response";
import { getGeocodingProvider } from "./geocoding";

const searchQuery = z.object({
  q: z.string().max(100),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
const reverseQuery = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) });

export const placesRouter = Router();
placesRouter.use(requireAuth);

// GET /places/search?q=ikeja&lat=6.45&lng=3.4  -> Place[] (same shape as saved places, kind "search")
placesRouter.get(
  "/search",
  validate(searchQuery, "query"),
  asyncHandler(async (req, res) => {
    const { q, lat, lng, limit } = req.query as any;
    ok(res, await getGeocodingProvider().search(q, { near: lat !== undefined && lng !== undefined ? { lat, lng } : undefined, limit }));
  })
);

// GET /places/reverse?lat=..&lng=..  -> Place | null
placesRouter.get(
  "/reverse",
  validate(reverseQuery, "query"),
  asyncHandler(async (req, res) => {
    const { lat, lng } = req.query as any;
    ok(res, await getGeocodingProvider().reverse(lat, lng));
  })
);
