import { db } from "@/db/knex";

export const driversRepository = {
  findUser(userId: string) {
    return db("users").where({ id: userId }).first();
  },

  findProfile(userId: string) {
    return db("driver_profiles").where({ user_id: userId }).first();
  },

  updateUser(userId: string, patch: Record<string, unknown>) {
    return db("users").where({ id: userId }).update({ ...patch, updated_at: db.fn.now() }).returning("*");
  },

  updateProfile(userId: string, patch: Record<string, unknown>) {
    return db("driver_profiles").where({ user_id: userId }).update({ ...patch, updated_at: db.fn.now() }).returning("*");
  },

  findVehicle(driverId: string) {
    return db("vehicles").where({ driver_id: driverId, is_active: true }).first();
  },

  async upsertVehicle(driverId: string, input: Record<string, unknown>) {
    const existing = await db("vehicles").where({ driver_id: driverId, is_active: true }).first();
    if (existing) {
      const [row] = await db("vehicles").where({ id: existing.id }).update({ ...input, updated_at: db.fn.now() }).returning("*");
      return row;
    }
    const [row] = await db("vehicles").insert({ driver_id: driverId, ...input }).returning("*");
    return row;
  },

  listDocuments(ownerType: string, ownerId: string) {
    return db("documents").where({ owner_type: ownerType, owner_id: ownerId }).orderBy("created_at", "asc");
  },

  findDocument(ownerType: string, ownerId: string, docKey: string) {
    return db("documents").where({ owner_type: ownerType, owner_id: ownerId, doc_key: docKey }).first();
  },

  async upsertDocumentStatus(ownerType: string, ownerId: string, docKey: string, patch: Record<string, unknown>) {
    const existing = await db("documents").where({ owner_type: ownerType, owner_id: ownerId, doc_key: docKey }).first();
    if (existing) {
      const [row] = await db("documents").where({ id: existing.id }).update({ ...patch, updated_at: db.fn.now() }).returning("*");
      return row;
    }
    const [row] = await db("documents").insert({ owner_type: ownerType, owner_id: ownerId, doc_key: docKey, ...patch }).returning("*");
    return row;
  },

  async earningsForPeriod(driverId: string, since: Date) {
    const rows = await db("transactions")
      .where({ user_id: driverId, type: "fare_payment", status: "successful" })
      .andWhere("created_at", ">=", since)
      .select("amount", "created_at");
    return rows;
  },

  tripsCountForPeriod(driverId: string, since: Date) {
    return db("trips")
      .where({ driver_id: driverId, status: "completed" })
      .andWhere("completed_at", ">=", since)
      .count<{ count: string }[]>("id as count")
      .first();
  },

  async ledger(driverId: string, limit = 50) {
    return db("transactions").where({ user_id: driverId }).orderBy("created_at", "desc").limit(limit);
  },

  getWallet(userId: string) {
    return db("wallets").where({ user_id: userId }).first();
  },

  async createPayout(driverId: string, amount: number, fee: number, net: number, bankSnapshot: Record<string, unknown>) {
    const [row] = await db("payouts")
      .insert({
        driver_id: driverId,
        amount,
        fee,
        net,
        bank_snapshot: JSON.stringify(bankSnapshot),
        reference: `PO-${Math.floor(100000 + Math.random() * 900000)}`,
      })
      .returning("*");
    return row;
  },

  async debitWalletForPayout(userId: string, amount: number) {
    const wallet = await db("wallets").where({ user_id: userId }).first();
    if (!wallet) return;
    await db("wallets").where({ id: wallet.id }).decrement("balance", amount);
    await db("transactions").insert({
      wallet_id: wallet.id,
      user_id: userId,
      type: "payout",
      amount: -amount,
      status: "pending",
    });
  },

  listReviews(driverId: string) {
    return db("trips")
      .where({ driver_id: driverId })
      .whereNotNull("rating_by_commuter")
      .orderBy("completed_at", "desc")
      .limit(50)
      .select("id", "rating_by_commuter", "completed_at", "commuter_id");
  },
};

export const driversExtraRepository = {
  /** Opens an online session if none is open (unique partial index makes this race-safe). */
  async openSession(driverId: string) {
    await db("driver_online_sessions").insert({ driver_id: driverId }).onConflict(db.raw("(driver_id) where ended_at is null")).ignore();
  },

  async closeSession(driverId: string) {
    await db("driver_online_sessions").where({ driver_id: driverId }).whereNull("ended_at").update({ ended_at: db.fn.now() });
  },

  /** Seconds online within [from, to), counting an open session up to now. */
  async onlineSeconds(driverId: string, from: Date, to: Date): Promise<number> {
    const res = await db.raw(
      `select coalesce(sum(extract(epoch from (least(coalesce(ended_at, now()), ?::timestamptz) - greatest(started_at, ?::timestamptz)))), 0) as secs
       from driver_online_sessions
       where driver_id = ? and started_at < ?::timestamptz and coalesce(ended_at, now()) > ?::timestamptz`,
      [to, from, driverId, to, from]
    );
    return Math.round(Number(res.rows[0]?.secs ?? 0));
  },

  earningsBetween(driverId: string, from: Date, to: Date) {
    return db("transactions")
      .where({ user_id: driverId, type: "fare_payment", status: "successful" })
      .andWhere("created_at", ">=", from)
      .andWhere("created_at", "<", to)
      .select("amount", "created_at");
  },

  async completedTripStats(driverId: string, from: Date, to: Date) {
    const row = await db("trips")
      .where({ driver_id: driverId, status: "completed" })
      .andWhere("completed_at", ">=", from)
      .andWhere("completed_at", "<", to)
      .select(db.raw("count(*) as trips"), db.raw("coalesce(sum(distance_km),0) as km"))
      .first();
    return { trips: Number(row?.trips ?? 0), km: Number(row?.km ?? 0) };
  },

  getBank(driverId: string) {
    return db("driver_profiles")
      .where({ user_id: driverId })
      .select("payout_bank_name", "payout_bank_code", "payout_account_number", "payout_account_name")
      .first();
  },

  setBank(driverId: string, bank: { name: string; code?: string; number: string; accountName: string }) {
    return db("driver_profiles")
      .where({ user_id: driverId })
      .update({
        payout_bank_name: bank.name,
        payout_bank_code: bank.code ?? null,
        payout_account_number: bank.number,
        payout_account_name: bank.accountName,
        updated_at: db.fn.now(),
      });
  },

  getSettings(driverId: string) {
    return db("driver_profiles").where({ user_id: driverId }).select("settings").first();
  },

  setSettings(driverId: string, settings: Record<string, unknown>) {
    return db("driver_profiles").where({ user_id: driverId }).update({ settings: JSON.stringify(settings), updated_at: db.fn.now() });
  },

  countEmergencyContacts(userId: string) {
    return db("emergency_contacts").where({ user_id: userId }).count<{ count: string }[]>("id as count").first();
  },
};
