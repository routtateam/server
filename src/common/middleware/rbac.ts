import type { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthorizedError } from "@/common/utils/errors";
import type { Permission } from "@/modules/rbac/permissions";

/**
 * Server-side enforcement of the same permission model the admin dashboard's
 * `<RequirePermission>` component checks on the client. The client-side gate
 * is a UX convenience only — this middleware is the real boundary.
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new UnauthorizedError();
    const granted = req.user.permissions ?? [];
    const hasAll = permissions.every((p) => granted.includes(p));
    if (!hasAll) {
      throw new ForbiddenError(`Missing required permission(s): ${permissions.join(", ")}`);
    }
    next();
  };
}

/** Requires at least one of the given permissions. */
export function requireAnyPermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new UnauthorizedError();
    const granted = req.user.permissions ?? [];
    const hasAny = permissions.some((p) => granted.includes(p));
    if (!hasAny) {
      throw new ForbiddenError(`Missing required permission(s): one of ${permissions.join(", ")}`);
    }
    next();
  };
}
