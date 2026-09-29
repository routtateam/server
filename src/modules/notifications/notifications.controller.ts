import { asyncHandler } from "@/common/utils/asyncHandler";
import { ok } from "@/common/utils/response";
import { notificationsRepository } from "./notifications.repository";
import { UnauthorizedError } from "@/common/utils/errors";

function uid(req: any): string {
  if (!req.user) throw new UnauthorizedError();
  return req.user.id;
}

function toDto(row: any) {
  const today = new Date();
  const created = new Date(row.created_at);
  const isToday = created.toDateString() === today.toDateString();
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    time: row.created_at,
    read: row.read,
    group: isToday ? "today" : "earlier",
    kind: row.kind,
  };
}

export const notificationsController = {
  list: asyncHandler(async (req, res) => {
    const rows = await notificationsRepository.list(uid(req));
    ok(res, rows.map(toDto));
  }),

  markRead: asyncHandler(async (req, res) => {
    await notificationsRepository.markRead(uid(req), req.params.id);
    ok(res, { ok: true });
  }),

  markAllRead: asyncHandler(async (req, res) => {
    await notificationsRepository.markAllRead(uid(req));
    ok(res, { ok: true });
  }),

  unreadCount: asyncHandler(async (req, res) => {
    const row = await notificationsRepository.unreadCount(uid(req));
    ok(res, { count: Number(row?.count ?? 0) });
  }),
};
