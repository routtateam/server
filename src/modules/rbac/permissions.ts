// Canonical permission keys. Mirrors `Permission` in
// web-ui/src/types/index.ts exactly so `RequirePermission`/`usePermissions`
// on the admin dashboard map 1:1 onto server-enforced checks.
export const PERMISSIONS = [
  "dashboard.view",
  "trips.view",
  "trips.reassign",
  "support.view",
  "support.manage",
  "disputes.view",
  "disputes.resolve",
  "verifications.view",
  "verifications.review",
  "transporters.view",
  "commuters.view",
  "pricing.view",
  "pricing.manage",
  "promotions.view",
  "promotions.manage",
  "payouts.view",
  "payouts.approve",
  "premium.view",
  "premium.manage",
  "team.view",
  "team.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type AdminRoleName = "Super admin" | "Trip admin" | "Support admin" | "Finance admin";

/** Default permission sets per built-in admin role — seeded into role_permissions. */
export const DEFAULT_ROLE_PERMISSIONS: Record<AdminRoleName, Permission[]> = {
  "Super admin": [...PERMISSIONS],
  "Trip admin": [
    "dashboard.view",
    "trips.view",
    "trips.reassign",
    "disputes.view",
    "disputes.resolve",
    "verifications.view",
    "verifications.review",
    "transporters.view",
    "commuters.view",
  ],
  "Support admin": [
    "dashboard.view",
    "support.view",
    "support.manage",
    "disputes.view",
    "commuters.view",
    "transporters.view",
  ],
  "Finance admin": [
    "dashboard.view",
    "pricing.view",
    "pricing.manage",
    "promotions.view",
    "promotions.manage",
    "payouts.view",
    "payouts.approve",
    "premium.view",
    "premium.manage",
  ],
};

/** Roles for premium-business team members (separate, simpler ACL). */
export const BUSINESS_TEAM_ROLES = ["owner", "manager", "staff"] as const;
export type BusinessTeamRole = (typeof BUSINESS_TEAM_ROLES)[number];
