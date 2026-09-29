import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "@/modules/auth/jwt";
import { UnauthorizedError } from "@/common/utils/errors";
import type { UserType } from "@/common/types/express";

/** Requires a valid `Authorization: Bearer <token>` header; populates req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }
  const token = header.slice("Bearer ".length);
  try {
    req.user = verifyAccessToken(token);
    next();
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
}

/** Like requireAuth, but does not throw when no token is present. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    try {
      req.user = verifyAccessToken(header.slice("Bearer ".length));
    } catch {
      // ignore invalid token in optional mode
    }
  }
  next();
}

/** Restricts a route to one or more account types (commuter/driver/admin/business). */
export function requireUserType(...types: UserType[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new UnauthorizedError();
    if (!types.includes(req.user.userType)) {
      throw new UnauthorizedError(`This endpoint requires one of: ${types.join(", ")}`);
    }
    next();
  };
}
