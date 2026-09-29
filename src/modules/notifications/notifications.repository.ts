import { db } from "@/db/knex";

export const notificationsRepository = {
  list(userId: string) {
    return db("notifications").where({ user_id: userId }).orderBy("created_at", "desc").limit(100);
  },

  markRead(userId: string, id: string) {
    return db("notifications").where({ user_id: userId, id }).update({ read: true });
  },

  markAllRead(userId: string) {
    return db("notifications").where({ user_id: userId, read: false }).update({ read: true });
  },

  unreadCount(userId: string) {
    return db("notifications").where({ user_id: userId, read: false }).count<{ count: string }[]>("id as count").first();
  },
};
