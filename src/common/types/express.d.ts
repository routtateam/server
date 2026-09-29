import type { Permission } from "@/modules/rbac/permissions";

export type UserType = "commuter" | "driver" | "admin" | "business";

export interface AuthenticatedUser {
  id: string;
  userType: UserType;
  email?: string;
  phone?: string;
  /** Populated for admin/business users; empty array for commuter/driver. */
  permissions: Permission[];
  /** Business id, present when userType === "business". */
  businessId?: string;
  businessRole?: "owner" | "manager" | "staff";
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
