import { Router } from "express";
import { notificationsController } from "./notifications.controller";
import { requireAuth } from "@/common/middleware/auth";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get("/", notificationsController.list);
notificationsRouter.get("/unread-count", notificationsController.unreadCount);
notificationsRouter.patch("/:id/read", notificationsController.markRead);
notificationsRouter.patch("/read-all", notificationsController.markAllRead);
