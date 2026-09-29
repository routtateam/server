import { Queue } from "bullmq";
import { defaultQueueOptions } from "../redisConnection";

export interface CalculateTripSettlementJobData {
  tripId: string;
}

export interface ProcessPayoutJobData {
  payoutId: string;
}

export const SETTLEMENT_QUEUE_NAME = "settlements";
export const PAYOUT_QUEUE_NAME = "payouts";

let settlementQueue: Queue<CalculateTripSettlementJobData> | undefined;
let payoutQueue: Queue<ProcessPayoutJobData> | undefined;

/** Enqueued whenever a trip completes — computes the driver's net earning,
 *  the platform's commission, and credits the driver's wallet ledger. */
export function getSettlementQueue(): Queue<CalculateTripSettlementJobData> {
  if (!settlementQueue) settlementQueue = new Queue<CalculateTripSettlementJobData>(SETTLEMENT_QUEUE_NAME, defaultQueueOptions);
  return settlementQueue;
}

/** Enqueued when a driver/business requests a payout — talks to the Monnify
 *  adapter to (mock-)disburse funds and updates the payout record. */
export function getPayoutQueue(): Queue<ProcessPayoutJobData> {
  if (!payoutQueue) payoutQueue = new Queue<ProcessPayoutJobData>(PAYOUT_QUEUE_NAME, defaultQueueOptions);
  return payoutQueue;
}
