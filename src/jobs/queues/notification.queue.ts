import { Queue } from "bullmq";
import { defaultQueueOptions } from "../redisConnection";

export interface SendNotificationJobData {
  userId: string;
  title: string;
  body: string;
  kind?: "refund" | "schedule" | "promo" | "rating" | "referral" | "money" | "doc" | "star" | "chat" | "zone" | "system";
  /** Optionally also deliver via email/SMS, not just the in-app feed. */
  channels?: Array<"in_app" | "email" | "sms">;
}

export const NOTIFICATION_QUEUE_NAME = "notifications";

let queue: Queue<SendNotificationJobData> | undefined;
/** Lazily created so importing this module never opens a Redis connection (tests / no-Redis dev). */
export function getNotificationQueue(): Queue<SendNotificationJobData> {
  if (!queue) queue = new Queue<SendNotificationJobData>(NOTIFICATION_QUEUE_NAME, defaultQueueOptions);
  return queue;
}
