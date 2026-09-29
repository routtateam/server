import type { NextFunction, Request, Response } from "express";
import { AppError } from "@/common/utils/errors";
import { logger } from "@/common/utils/logger";
import type { ApiErrorBody } from "@/common/utils/response";

export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiErrorBody = {
    success: false,
    error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.originalUrl}` },
  };
  res.status(404).json(body);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    if (err.status >= 500) logger.error({ err }, err.message);
    else logger.warn({ code: err.code, path: req.originalUrl }, err.message);

    const body: ApiErrorBody = {
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.status).json(body);
    return;
  }

  logger.error({ err }, "Unhandled error");
  const body: ApiErrorBody = {
    success: false,
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
  };
  res.status(500).json(body);
}
