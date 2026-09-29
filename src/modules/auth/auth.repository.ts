import { db } from "@/db/knex";
import type { UserRow } from "./auth.types";
import type { UserType } from "@/common/types/express";
import type { Permission } from "@/modules/rbac/permissions";

export const authRepository = {
  findByPhone(phone: string) {
    return db<UserRow>("users").where({ phone }).whereNull("deleted_at").first();
  },

  findByEmail(email: string) {
    return db<UserRow>("users").where({ email: email.toLowerCase() }).whereNull("deleted_at").first();
  },

  findById(id: string) {
    return db<UserRow>("users").where({ id }).whereNull("deleted_at").first();
  },

  async createUser(input: {
    userType: UserType;
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    passwordHash?: string;
    referralCode?: string;
    phoneVerified?: boolean;
    emailVerified?: boolean;
  }): Promise<UserRow> {
    const [row] = await db<UserRow>("users")
      .insert({
        user_type: input.userType,
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email?.toLowerCase(),
        phone: input.phone,
        password_hash: input.passwordHash,
        referral_code: input.referralCode,
        phone_verified: input.phoneVerified ?? false,
        email_verified: input.emailVerified ?? false,
      })
      .returning("*");
    return row;
  },

  /** Creates a pending driver applicant + draft profile (+ optional vehicle) atomically. */
  async createDriverApplicant(input: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    city?: string;
    licenseNumber?: string;
    vehicle?: { category: string; make?: string; model?: string; year?: number; colour?: string; plate: string; seats?: number };
  }) {
    return db.transaction(async (trx) => {
      const [user] = await trx("users")
        .insert({
          user_type: "driver",
          first_name: input.firstName,
          last_name: input.lastName,
          email: input.email?.toLowerCase(),
          phone: input.phone,
          phone_verified: false,
          status: "pending",
        })
        .returning("*");
      await trx("wallets").insert({ user_id: user.id, balance: 0 });
      await trx("driver_profiles").insert({
        user_id: user.id,
        city: input.city,
        license_number: input.licenseNumber,
        verified: false,
        member_since_year: new Date().getFullYear(),
      });
      if (input.vehicle) {
        await trx("vehicles").insert({
          driver_id: user.id,
          category: input.vehicle.category,
          make: input.vehicle.make,
          model: input.vehicle.model,
          year: input.vehicle.year,
          colour: input.vehicle.colour,
          plate: input.vehicle.plate.toUpperCase(),
          seats: input.vehicle.seats,
        });
      }
      return user as UserRow;
    });
  },

  vehicleByPlate(plate: string) {
    return db("vehicles").whereRaw("upper(plate) = upper(?)", [plate]).first();
  },

  async ensureWallet(userId: string) {
    const existing = await db("wallets").where({ user_id: userId }).first();
    if (existing) return existing;
    const [wallet] = await db("wallets").insert({ user_id: userId, balance: 0 }).returning("*");
    return wallet;
  },

  async ensureDriverProfile(userId: string) {
    const existing = await db("driver_profiles").where({ user_id: userId }).first();
    if (existing) return existing;
    const [profile] = await db("driver_profiles").insert({ user_id: userId }).returning("*");
    return profile;
  },

  async createOtp(identifier: string, channel: "sms" | "email", purpose: string, codeHash: string, ttlSeconds: number) {
    const [row] = await db("otps")
      .insert({
        identifier,
        channel,
        purpose,
        code_hash: codeHash,
        expires_at: db.raw(`now() + interval '${ttlSeconds} seconds'`),
      })
      .returning("*");
    return row;
  },

  async latestActiveOtp(identifier: string, purpose: string) {
    return db("otps")
      .where({ identifier, purpose })
      .whereNull("consumed_at")
      .andWhere("expires_at", ">", db.fn.now())
      .orderBy("created_at", "desc")
      .first();
  },

  async incrementOtpAttempts(id: string) {
    await db("otps").where({ id }).increment("attempts", 1);
  },

  async consumeOtp(id: string) {
    await db("otps").where({ id }).update({ consumed_at: db.fn.now() });
  },

  async getPermissionsForUser(userId: string): Promise<Permission[]> {
    const rows = await db("user_roles as ur")
      .join("role_permissions as rp", "rp.role_id", "ur.role_id")
      .join("permissions as p", "p.id", "rp.permission_id")
      .where("ur.user_id", userId)
      .distinct("p.key");
    return rows.map((r) => r.key as Permission);
  },

  async getRoleForUser(userId: string): Promise<{ id: string; name: string } | undefined> {
    return db("user_roles as ur")
      .join("roles as r", "r.id", "ur.role_id")
      .where("ur.user_id", userId)
      .select("r.id", "r.name")
      .first();
  },

  async getBusinessForOwner(userId: string) {
    return db("businesses").where({ owner_user_id: userId }).first();
  },

  async getBusinessTeamMembership(userId: string) {
    return db("business_team_members").where({ user_id: userId, status: "active" }).first();
  },

  async touchLastActive(userId: string) {
    await db("users").where({ id: userId }).update({ last_active_at: db.fn.now() });
  },
};
