import { db } from "@/db/knex";

export const paymentsRepository = {
  getWallet(userId: string) {
    return db("wallets").where({ user_id: userId }).first();
  },

  async ensureWallet(userId: string) {
    const existing = await db("wallets").where({ user_id: userId }).first();
    if (existing) return existing;
    const [row] = await db("wallets").insert({ user_id: userId, balance: 0 }).returning("*");
    return row;
  },

  listPaymentMethods(userId: string) {
    return db("payment_methods").where({ user_id: userId }).orderBy("is_default", "desc");
  },

  async addPaymentMethod(userId: string, input: Record<string, unknown>) {
    if (input.is_default) {
      await db("payment_methods").where({ user_id: userId }).update({ is_default: false });
    }
    const [row] = await db("payment_methods").insert({ user_id: userId, ...input }).returning("*");
    return row;
  },

  removePaymentMethod(userId: string, id: string) {
    return db("payment_methods").where({ user_id: userId, id }).del();
  },

  createPendingTransaction(input: Record<string, unknown>) {
    return db("transactions").insert(input).returning("*");
  },

  findTransactionByReference(reference: string) {
    return db("transactions").where({ provider_reference: reference }).first();
  },

  async markTransactionSuccessful(id: string) {
    const [row] = await db("transactions").where({ id }).update({ status: "successful" }).returning("*");
    return row;
  },

  async creditWallet(walletId: string, amount: number) {
    await db("wallets").where({ id: walletId }).increment("balance", amount);
  },

  activePromoByCode(code: string) {
    return db("promotions").whereRaw("lower(code) = lower(?)", [code]).andWhere({ status: "active" }).first();
  },

  listActivePromotions() {
    return db("promotions").where({ status: "active" }).orderBy("created_at", "desc");
  },
};
