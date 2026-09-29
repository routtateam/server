import type { NextFunction, Request, Response } from "express";
import { AppError } from "@/common/utils/errors";

/**
 * Minimal in-memory fixed-window limiter for public endpoints. Per-process only: behind multiple API
 * instances use a shared store (e.g. Redis) instead. `key` defaults to the client IP.
 */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    const k = opts.key ? opts.key(req) : req.ip ?? "unknown";
    const entry = hits.get(k);
    if (!entry || entry.resetAt <= now) {
      hits.set(k, { count: 1, resetAt: now + opts.windowMs });
      if (hits.size > 10_000) for (const [key, v] of hits) if (v.resetAt <= now) hits.delete(key);
      return next();
    }
    entry.count += 1;
    if (entry.count > opts.max) throw new AppError("Too many requests — please try again later.", 429, "RATE_LIMITED");
    next();
  };
}
