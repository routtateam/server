import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import { ValidationError } from "@/common/utils/errors";

type Target = "body" | "query" | "params";

/** Validates req[target] against a zod schema and replaces it with the parsed value. */
export function validate(schema: ZodTypeAny, target: Target = "body") {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      throw new ValidationError("Request failed validation", result.error.flatten());
    }
    (req as any)[target] = result.data;
    next();
  };
}
