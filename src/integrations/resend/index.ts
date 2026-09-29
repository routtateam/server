// Resend transactional email adapter — SANDBOX-SHAPED STUB.
//
// Uses the official `resend` npm SDK's method shapes (resend.emails.send)
// so this adapter is a thin, swappable wrapper. IMPORTANT: no real Resend
// API key exists yet. Unless RESEND_LIVE_MODE=true AND a non-placeholder
// RESEND_API_KEY is configured, `sendEmail` never calls the real API — it
// logs the would-be email and returns a mock message id. Before going
// live: create a Resend account + verified sending domain, generate a real
// API key, and flip RESEND_LIVE_MODE.
import { Resend } from "resend";
import { env } from "@/config/env";
import { logger } from "@/common/utils/logger";
import type { SendEmailRequest, SendEmailResponse } from "./types";

const isLive = () => env.resend.liveMode && !env.resend.apiKey.startsWith("re_test");

let client: Resend | null = null;
function getClient(): Resend {
  if (!client) client = new Resend(env.resend.apiKey);
  return client;
}

export const resendAdapter = {
  async sendEmail(req: SendEmailRequest): Promise<SendEmailResponse> {
    const from = req.from ?? env.resend.fromEmail;
    if (!isLive()) {
      logger.info({ to: req.to, subject: req.subject, from }, "[resend:mock] sendEmail — no live credentials, not sent");
      return { id: `mock_email_${Date.now()}` };
    }
    const { data, error } = await getClient().emails.send({
      from,
      to: req.to,
      subject: req.subject,
      html: req.html,
      text: req.text,
      cc: req.cc,
      bcc: req.bcc,
      replyTo: req.reply_to,
      tags: req.tags,
    } as any);
    if (error) throw new Error(`Resend sendEmail failed: ${error.message}`);
    return { id: data?.id ?? "unknown" };
  },

  // --- Convenience templates used by domain modules/jobs ---

  async sendOtpEmail(to: string, code: string) {
    if (!isLive()) {
      // No real email provider configured — this code was never actually delivered.
      // Log it so it's visible without a frontend that surfaces devOtpHint.
      logger.warn({ to, code }, "[OTP] not sent via email (Resend not live) — code for manual testing");
    }
    return this.sendEmail({
      to,
      subject: "Your Routta verification code",
      html: `<p>Your Routta verification code is <strong>${code}</strong>. It expires in 5 minutes.</p>`,
      text: `Your Routta verification code is ${code}. It expires in 5 minutes.`,
    });
  },

  async sendTripReceiptEmail(to: string, tripId: string, fareNaira: number) {
    return this.sendEmail({
      to,
      subject: "Your Routta trip receipt",
      html: `<p>Thanks for riding with Routta. Trip <strong>${tripId}</strong> — total ₦${fareNaira.toLocaleString()}.</p>`,
      text: `Thanks for riding with Routta. Trip ${tripId} — total NGN ${fareNaira.toLocaleString()}.`,
    });
  },

  async sendPayoutConfirmationEmail(to: string, amountNaira: number, reference: string) {
    return this.sendEmail({
      to,
      subject: "Your Routta payout is on its way",
      html: `<p>₦${amountNaira.toLocaleString()} is on its way to your bank account. Reference: <strong>${reference}</strong>.</p>`,
      text: `NGN ${amountNaira.toLocaleString()} is on its way to your bank account. Reference: ${reference}.`,
    });
  },
};
