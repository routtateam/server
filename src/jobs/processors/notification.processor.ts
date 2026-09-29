import type { Job } from "bullmq";
import { db } from "@/db/knex";
import { logger } from "@/common/utils/logger";
import { resendAdapter } from "@/integrations/resend";
import { termii } from "@/integrations/termii";
import type { SendNotificationJobData } from "../queues/notification.queue";

/** Writes the in-app notification row and, if requested, fans it out over email/SMS via the
 *  sandbox-stubbed adapters. Shared by the BullMQ worker and the inline dispatcher. */
export async function deliverNotification(data: SendNotificationJobData): Promise<void> {
  const { userId, title, body, kind = "system", channels = ["in_app"] } = data;

  const user = await db("users").where({ id: userId }).first();
  if (!user) {
    logger.warn({ userId }, "send-notification job: user not found, skipping");
    return;
  }

  if (channels.includes("in_app")) {
    await db("notifications").insert({ user_id: userId, title, body, kind, read: false });
  }

  if (channels.includes("email") && user.email) {
    await resendAdapter.sendEmail({ to: user.email, subject: title, text: body });
  }

  if (channels.includes("sms") && user.phone) {
    await termii.sendMessage({ to: user.phone, from: "Routta", sms: `${title}: ${body}`, type: "plain", channel: "generic" });
  }
}

export async function processSendNotification(job: Job<SendNotificationJobData>): Promise<void> {
  await deliverNotification(job.data);
}
