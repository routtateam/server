import { db } from "@/db/knex";

export const usersRepository = {
  findById(id: string) {
    return db("users").where({ id }).whereNull("deleted_at").first();
  },

  updateProfile(id: string, patch: Record<string, unknown>) {
    return db("users").where({ id }).update({ ...patch, updated_at: db.fn.now() }).returning("*");
  },

  countRidesForCommuter(commuterId: string) {
    return db("trips").where({ commuter_id: commuterId, status: "completed" }).count<{ count: string }[]>("id as count").first();
  },

  listPlaces(userId: string) {
    return db("saved_places").where({ user_id: userId }).orderBy("created_at", "desc");
  },

  createPlace(userId: string, input: Record<string, unknown>) {
    return db("saved_places").insert({ user_id: userId, ...input }).returning("*");
  },

  deletePlace(userId: string, placeId: string) {
    return db("saved_places").where({ user_id: userId, id: placeId }).del();
  },

  listEmergencyContacts(userId: string) {
    return db("emergency_contacts").where({ user_id: userId }).orderBy("is_primary", "desc");
  },

  createEmergencyContact(userId: string, input: Record<string, unknown>) {
    return db("emergency_contacts").insert({ user_id: userId, ...input }).returning("*");
  },

  deleteEmergencyContact(userId: string, contactId: string) {
    return db("emergency_contacts").where({ user_id: userId, id: contactId }).del();
  },
};

export const usersAccountRepository = {
  activeTripCount(commuterId: string) {
    return db("trips")
      .where({ commuter_id: commuterId })
      .whereIn("status", ["matching", "accepted", "enroute", "arrived", "in_progress", "active"])
      .count<{ count: string }[]>("id as count")
      .first();
  },

  walletBalance(userId: string) {
    return db("wallets").where({ user_id: userId }).first();
  },

  /**
   * Soft delete + anonymise, in one transaction. The row is kept (trips, transactions and disputes reference it for
   * finance/legal reasons) but every personal field is removed so it can no longer identify the person.
   */
  async softDeleteAndAnonymise(userId: string) {
    await db.transaction(async (trx) => {
      await trx("users")
        .where({ id: userId })
        .update({
          first_name: "Deleted",
          last_name: "User",
          email: `deleted+${userId}@deleted.routta.invalid`,
          email_verified: false,
          phone: null,
          phone_verified: false,
          avatar_url: null,
          referral_code: null,
          password_hash: null,
          status: "suspended",
          deleted_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
      await trx("saved_places").where({ user_id: userId }).del();
      await trx("emergency_contacts").where({ user_id: userId }).del();
      await trx("payment_methods").where({ user_id: userId }).del();
      await trx("notifications").where({ user_id: userId }).del();
      await trx("scheduled_rides").where({ commuter_id: userId, status: "scheduled" }).update({ status: "cancelled" });
    });
  },
};
