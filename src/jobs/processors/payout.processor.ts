import type { Job } from "bullmq";
import { db } from "@/db/knex";
import { logger } from "@/common/utils/logger";
import { monnify } from "@/integrations/monnify";
import { resendAdapter } from "@/integrations/resend";
import { dispatchNotification } from "../dispatch";
import { settleTrip } from "./settlement";
import type { CalculateTripSettlementJobData, ProcessPayoutJobData } from "../queues/payout.queue";

/** BullMQ handler: thin wrapper over the idempotent settleTrip(). */
export async function processCalculateTripSettlement(job: Job<CalculateTripSettlementJobData>): Promise<void> {
  await settleTrip(job.data.tripId);
}

/** Real, representative job: drives a driver/business payout through the
 *  (sandbox-stubbed) Monnify disbursement API and records the outcome. */
export async function processPayout(job: Job<ProcessPayoutJobData>): Promise<void> {
  await runPayout(job.data.payoutId);
}

export async function runPayout(payoutId: string): Promise<void> {
  const payout = await db("payouts").where({ id: payoutId }).first();
  // Admin approval moves a payout to "processing" before it is dispatched, so both states are runnable.
  if (!payout || !["pending", "processing"].includes(payout.status)) {
    logger.warn({ payoutId }, "payout job: not found or not pending, skipping");
    return;
  }

  await db("payouts").where({ id: payoutId }).update({ status: "processing" });

  const bank = payout.bank_snapshot ?? {};
  const transfer = await monnify.initiateTransfer({
    amount: Number(payout.net) / 100,
    reference: payout.reference ?? `PO-${payoutId}`,
    narration: "Routta driver payout",
    destinationBankCode: bank.bankCode ?? "000000",
    destinationAccountNumber: bank.accountNumber ?? "0000000000",
    currency: "NGN",
  });

  const success = transfer.responseBody.status === "SUCCESS";
  await db("payouts")
    .where({ id: payoutId })
    .update({ status: success ? "paid" : "failed", processed_at: db.fn.now() });

  const driver = await db("users").where({ id: payout.driver_id }).first();
  if (driver?.email) {
    await resendAdapter.sendPayoutConfirmationEmail(driver.email, Number(payout.net) / 100, payout.reference ?? payoutId);
  }

  await dispatchNotification({
    userId: payout.driver_id,
    title: success ? "Payout sent" : "Payout failed",
    body: success
      ? `₦${(Number(payout.net) / 100).toLocaleString()} is on its way to your bank account.`
      : "Your payout could not be processed. Our team has been notified.",
    kind: "money",
  });
}
