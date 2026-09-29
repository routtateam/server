// Single entry point for "run this background work". Producers (services) call these helpers instead of
// touching BullMQ queues directly, so that:
//   * with Redis reachable the work is enqueued (BullMQ worker process runs it), and
//   * without Redis (local dev / tests) the SAME processor logic runs inline in the API process.
// In production (NODE_ENV=production) JOBS_MODE=auto never falls back inline: a missing Redis is a
// deployment error and enqueueing will fail loudly. Every processor is idempotent, so a job that is both
// enqueued and later re-run (worker retry, reconcile sweep) never double-applies.
import { Redis } from "ioredis";
import { env } from "@/config/env";
import { logger } from "@/common/utils/logger";
import { redisConnection } from "./redisConnection";
import { getNotificationQueue, type SendNotificationJobData } from "./queues/notification.queue";
import { getPayoutQueue, getSettlementQueue } from "./queues/payout.queue";

let cachedAvailable: { value: boolean; at: number } | undefined;
const CACHE_MS = 10_000;

async function pingRedis(): Promise<boolean> {
  const opts: any = "url" in redisConnection ? redisConnection.url : redisConnection;
  const client = new Redis(opts as any, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    connectTimeout: 500,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  } as any);
  client.on("error", () => undefined); // swallow: we only care about the boolean result
  try {
    await client.connect();
    await client.ping();
    return true;
  } catch {
    return false;
  } finally {
    client.disconnect();
  }
}

/** True if background work should be enqueued on BullMQ; false if it should run inline. */
export async function shouldUseQueue(): Promise<boolean> {
  if (env.jobsMode === "inline") return false;
  if (env.jobsMode === "queue") return true;
  if (env.isProduction) return true;
  if (cachedAvailable && Date.now() - cachedAvailable.at < CACHE_MS) return cachedAvailable.value;
  const value = await pingRedis();
  cachedAvailable = { value, at: Date.now() };
  if (!value) logger.warn("Redis unreachable — running background jobs inline (development fallback)");
  return value;
}

export async function dispatchTripSettlement(tripId: string): Promise<void> {
  try {
    if (await shouldUseQueue()) {
      await getSettlementQueue().add("calculate-trip-settlement", { tripId }, { jobId: `settle-${tripId}` });
      return;
    }
    const { settleTrip } = await import("./processors/settlement");
    await settleTrip(tripId);
  } catch (err) {
    // The trip is already completed; never fail the request. The reconcile sweep (see reconcileUnsettledTrips)
    // picks up any completed-but-unsettled trip.
    logger.error({ err, tripId }, "trip settlement dispatch failed");
  }
}

export async function dispatchNotification(data: SendNotificationJobData): Promise<void> {
  try {
    if (await shouldUseQueue()) {
      await getNotificationQueue().add("send-notification", data);
      return;
    }
    const { deliverNotification } = await import("./processors/notification.processor");
    await deliverNotification(data);
  } catch (err) {
    logger.error({ err }, "notification dispatch failed");
  }
}

export async function dispatchPayout(payoutId: string): Promise<void> {
  try {
    if (await shouldUseQueue()) {
      await getPayoutQueue().add("process-payout", { payoutId });
      return;
    }
    const { runPayout } = await import("./processors/payout.processor");
    await runPayout(payoutId);
  } catch (err) {
    logger.error({ err, payoutId }, "payout dispatch failed");
  }
}
