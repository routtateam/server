// Termii SMS/OTP adapter — SANDBOX-SHAPED STUB.
//
// This module implements the same method signatures / request-response
// shapes as Termii's real REST API (https://developers.termii.com) so the
// rest of the codebase can be wired unchanged once real credentials exist.
//
// IMPORTANT: no real Termii API key is configured yet. Unless
// TERMII_LIVE_MODE=true *and* a real TERMII_API_KEY is set, every method
// below short-circuits before making an HTTP call and returns a realistic
// mock response, logging what would have been sent. Flip TERMII_LIVE_MODE
// on only after the project has real Termii sandbox/production credentials
// and has smoke-tested against Termii's own sandbox.
import { env } from "@/config/env";
import { logger } from "@/common/utils/logger";
import type {
  TermiiSendMessageRequest,
  TermiiSendMessageResponse,
  TermiiSendOtpRequest,
  TermiiSendOtpResponse,
  TermiiVerifyOtpRequest,
  TermiiVerifyOtpResponse,
} from "./types";

const isLive = () => env.termii.liveMode && !env.termii.apiKey.startsWith("TL_TEST");

async function callTermii<TReq, TRes>(path: string, payload: TReq): Promise<TRes> {
  const url = `${env.termii.baseUrl}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, api_key: env.termii.apiKey }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Termii request failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TRes;
}

export const termii = {
  /** Sends a plain SMS. Mirrors POST /api/sms/send. */
  async sendMessage(req: Omit<TermiiSendMessageRequest, "api_key">): Promise<TermiiSendMessageResponse> {
    if (!isLive()) {
      logger.info({ to: req.to, sms: req.sms }, "[termii:mock] sendMessage — no live credentials, not sent");
      return { message_id: `mock_${Date.now()}`, message: "Message sent (mock)", balance: 1000, user: "Routta (mock)" };
    }
    return callTermii<TermiiSendMessageRequest, TermiiSendMessageResponse>("/api/sms/send", {
      ...req,
      from: req.from || env.termii.senderId,
    });
  },

  /** Sends an OTP PIN via Termii's managed OTP flow. Mirrors POST /api/sms/otp/send. */
  async sendOtp(req: Omit<TermiiSendOtpRequest, "api_key" | "from"> & { from?: string }): Promise<TermiiSendOtpResponse> {
    if (!isLive()) {
      logger.info({ to: req.to }, "[termii:mock] sendOtp — no live credentials, not sent");
      return { pinId: `mock_pin_${Date.now()}`, to: req.to, smsStatus: "Message Sent" };
    }
    return callTermii<TermiiSendOtpRequest, TermiiSendOtpResponse>("/api/sms/otp/send", {
      ...req,
      from: req.from || env.termii.senderId,
    });
  },

  /** Verifies a PIN against Termii's managed OTP flow. Mirrors POST /api/sms/otp/verify.
   *  This backend also supports its own DB-backed OTP flow (see modules/auth) so callers
   *  are not required to depend on Termii's own PIN state. */
  async verifyOtp(req: Omit<TermiiVerifyOtpRequest, "api_key">): Promise<TermiiVerifyOtpResponse> {
    if (!isLive()) {
      logger.info({ pinId: req.pin_id }, "[termii:mock] verifyOtp — no live credentials, auto-approving");
      return { pinId: req.pin_id, verified: "True", msisdn: "" };
    }
    return callTermii<TermiiVerifyOtpRequest, TermiiVerifyOtpResponse>("/api/sms/otp/verify", req);
  },
};
