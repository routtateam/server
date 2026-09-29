import request from "supertest";
import { createApp } from "@/app";
import { db } from "@/db/knex";
import { signAccessToken } from "@/modules/auth/jwt";
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, type Permission } from "@/modules/rbac/permissions";

export const app = createApp();
export const api = () => request(app);
export const P = "/api/v1";

export async function userByEmail(email: string) {
  return db("users").where({ email }).first();
}
export async function userByPhone(phone: string) {
  return db("users").where({ phone }).first();
}

export function tokenFor(user: { id: string; user_type: string }, extra: Record<string, unknown> = {}) {
  return signAccessToken({ id: user.id, userType: user.user_type as any, permissions: [] as Permission[], ...extra } as any);
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function personas() {
  const commuter = await userByPhone("+2348034112094");
  const driver = await userByPhone("+2348025550148");
  const admin = await userByEmail("funke@routta.ng");
  const bizOwner = await userByEmail("kayode@eliteridelagos.ng");
  const business = await db("businesses").where({ owner_user_id: bizOwner.id }).first();
  return {
    commuter, driver, admin, bizOwner, business,
    commuterToken: tokenFor(commuter),
    driverToken: tokenFor(driver),
    adminToken: tokenFor(admin, { permissions: [...PERMISSIONS] }),
    supportAdminToken: tokenFor(admin, { permissions: DEFAULT_ROLE_PERMISSIONS["Support admin"] }),
    bizToken: tokenFor(bizOwner, { businessId: business.id, businessRole: "owner" }),
  };
}

let seq = 0;
/** Creates a fresh in-progress trip (commuter -> seeded driver) so tests never depend on each other's data. */
export async function makeTrip(p: Awaited<ReturnType<typeof personas>>, status = "in_progress", fare = 200000) {
  const [row] = await db("trips")
    .insert({
      commuter_id: p.commuter.id,
      driver_id: status === "matching" ? null : p.driver.id,
      category: "car",
      pickup_label: `Test pickup ${++seq}`,
      pickup_lat: 6.43,
      pickup_lng: 3.42,
      destination_label: "Test destination",
      destination_lat: 6.6,
      destination_lng: 3.35,
      distance_km: 10,
      fare,
      status,
      pin: "4321",
      accepted_at: db.fn.now(),
      started_at: status === "in_progress" ? db.fn.now() : null,
    })
    .returning("*");
  return row;
}
