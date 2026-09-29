// Worker process entrypoint — run separately from the API process:
//   npm run worker        (prod, after `npm run build`)
//   npm run worker:dev     (dev, via tsx watch)
//
// Each BullMQ Worker below consumes one queue. Keeping producers (queues,
// used from request handlers/event subscribers) and consumers (workers,
// this file) in separate modules means the API process can enqueue jobs
// without needing to run a worker in-process, and the worker process can
// scale independently.
import "dotenv/config";
import { Worker } from "bullmq";
import { defaultQueueOptions } from "../redisConnection";
import { NOTIFICATION_QUEUE_NAME } from "../queues/notification.queue";
import { PAYOUT_QUEUE_NAME, SETTLEMENT_QUEUE_NAME } from "../queues/payout.queue";
import { processSendNotification } from "../processors/notification.processor";
import { processCalculateTripSettlement, processPayout } from "../processors/payout.processor";
import { logger } from "@/common/utils/logger";

const workers = [
  new Worker(NOTIFICATION_QUEUE_NAME, processSendNotification, { connection: defaultQueueOptions.connection }),
  new Worker(SETTLEMENT_QUEUE_NAME, processCalculateTripSettlement, { connection: defaultQueueOptions.connection }),
  new Worker(PAYOUT_QUEUE_NAME, processPayout, { connection: defaultQueueOptions.connection }),
];

for (const worker of workers) {
  worker.on("completed", (job) => logger.info({ queue: worker.name, jobId: job.id }, "job completed"));
  worker.on("failed", (job, err) => logger.error({ queue: worker.name, jobId: job?.id, err }, "job failed"));
}

logger.info(`Routta job workers started (${workers.map((w) => w.name).join(", ")})`);

process.on("SIGTERM", async () => {
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
});
