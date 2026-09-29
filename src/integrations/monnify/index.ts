// Monnify payment adapter — SANDBOX-SHAPED STUB.
//
// Implements the same method signatures / request-response shapes as
// Monnify's real API (https://developers.monnify.com: OAuth2 client-credentials
// auth, "Initiate Transaction", "Get Transaction Status", "Initiate Transfer",
// webhook payload) so the rest of the codebase (wallet top-ups, trip fare
// capture, driver payouts) can be wired to the live adapter later by only
// flipping MONNIFY_LIVE_MODE and supplying real MONNIFY_* credentials.
//
// IMPORTANT: no real Monnify credentials exist yet. Every method below is
// mocked: it does not perform a real HTTP call unless MONNIFY_LIVE_MODE=true
// AND a non-placeholder MONNIFY_API_KEY/SECRET_KEY are configured. Before
// going live: get real sandbox credentials from Monnify, test each method
// against https://sandbox.monnify.com, then swap to production keys.
import crypto from "node:crypto";
import { env } from "@/config/env";
import { logger } from "@/common/utils/logger";
import type {
  InitiateTransactionRequest,
  InitiateTransactionResponse,
  InitiateTransferRequest,
  InitiateTransferResponse,
  MonnifyAuthResponse,
  MonnifyWebhookPayload,
  VerifyTransactionResponse,
} from "./types";

const isLive = () => env.monnify.liveMode && !env.monnify.apiKey.startsWith("MK_TEST");

let cachedToken: { token: string; expiresAt: number } | null = null;

async function authenticate(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const basic = Buffer.from(`${env.monnify.apiKey}:${env.monnify.secretKey}`).toString("base64");
  const res = await fetch(`${env.monnify.baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) throw new Error(`Monnify auth failed (${res.status})`);
  const body = (await res.json()) as MonnifyAuthResponse;
  cachedToken = { token: body.responseBody.accessToken, expiresAt: Date.now() + body.responseBody.expiresIn * 1000 };
  return cachedToken.token;
}

export const monnify = {
  /** Initiates a hosted checkout transaction. Mirrors POST /api/v1/merchant/transactions/init-transaction. */
  async initiatePayment(req: Omit<InitiateTransactionRequest, "contractCode" | "currencyCode">): Promise<InitiateTransactionResponse> {
    if (!isLive()) {
      logger.info({ ref: req.paymentReference, amount: req.amount }, "[monnify:mock] initiatePayment — no live credentials");
      return {
        requestSuccessful: true,
        responseMessage: "success",
        responseCode: "0",
        responseBody: {
          transactionReference: `MNFY|MOCK|${Date.now()}`,
          paymentReference: req.paymentReference,
          merchantName: "Routta (sandbox)",
          apiKey: env.monnify.apiKey,
          enabledPaymentMethod: req.paymentMethods ?? ["CARD", "ACCOUNT_TRANSFER"],
          checkoutUrl: `${env.monnify.baseUrl}/mock-checkout/${req.paymentReference}`,
        },
      };
    }
    const token = await authenticate();
    const res = await fetch(`${env.monnify.baseUrl}/api/v1/merchant/transactions/init-transaction`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...req, contractCode: env.monnify.contractCode, currencyCode: "NGN" }),
    });
    if (!res.ok) throw new Error(`Monnify initiatePayment failed (${res.status})`);
    return (await res.json()) as InitiateTransactionResponse;
  },

  /** Verifies a transaction's status. Mirrors GET /api/v2/transactions/{transactionReference}. */
  async verifyTransaction(transactionReference: string): Promise<VerifyTransactionResponse> {
    if (!isLive()) {
      logger.info({ transactionReference }, "[monnify:mock] verifyTransaction — no live credentials, returning PAID");
      return {
        requestSuccessful: true,
        responseMessage: "success",
        responseCode: "0",
        responseBody: {
          transactionReference,
          paymentReference: transactionReference,
          amountPaid: 0,
          totalPayable: 0,
          settlementAmount: 0,
          paidOn: new Date().toISOString(),
          paymentStatus: "PAID",
          paymentMethod: "CARD",
          currency: "NGN",
          customer: { email: "mock@routta.app", name: "Mock Customer" },
        },
      };
    }
    const token = await authenticate();
    const res = await fetch(`${env.monnify.baseUrl}/api/v2/transactions/${encodeURIComponent(transactionReference)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Monnify verifyTransaction failed (${res.status})`);
    return (await res.json()) as VerifyTransactionResponse;
  },

  /** Initiates a single disbursement (used for driver/business payouts). Mirrors POST /api/v2/disbursements/single. */
  async initiateTransfer(req: InitiateTransferRequest): Promise<InitiateTransferResponse> {
    if (!isLive()) {
      logger.info({ ref: req.reference, amount: req.amount }, "[monnify:mock] initiateTransfer — no live credentials");
      return {
        requestSuccessful: true,
        responseMessage: "success",
        responseCode: "0",
        responseBody: { reference: req.reference, status: "SUCCESS", amount: req.amount, dateCreated: new Date().toISOString() },
      };
    }
    const token = await authenticate();
    const res = await fetch(`${env.monnify.baseUrl}/api/v2/disbursements/single`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) throw new Error(`Monnify initiateTransfer failed (${res.status})`);
    return (await res.json()) as InitiateTransferResponse;
  },

  /**
   * Validates a Monnify webhook's signature. Monnify signs webhooks with
   * `transaction-hash` = SHA512(clientSecret + requestBody) — see their docs.
   * Kept generic here since we don't have real secrets to test against yet.
   */
  verifyWebhookSignature(rawBody: string, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = crypto
      .createHash("sha512")
      .update(env.monnify.secretKey + rawBody)
      .digest("hex");
    return expected === signatureHeader;
  },

  /** Webhook handler stub — parses + (optionally) verifies, then returns a normalised event.
   *  Wire this up behind a raw-body Express route once real webhook secrets exist. */
  parseWebhook(rawBody: string, signatureHeader: string | undefined): MonnifyWebhookPayload {
    if (env.monnify.liveMode && !this.verifyWebhookSignature(rawBody, signatureHeader)) {
      throw new Error("Invalid Monnify webhook signature");
    }
    return JSON.parse(rawBody) as MonnifyWebhookPayload;
  },
};
