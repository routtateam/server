// Consistent API response envelope used by every module's controllers.
import type { Response } from "express";

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>, status = 200): void {
  const body: ApiSuccessBody<T> = { success: true, data, ...(meta ? { meta } : {}) };
  res.status(status).json(body);
}

export function created<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  ok(res, data, meta, 201);
}

export function noContent(res: Response): void {
  res.status(204).send();
}
