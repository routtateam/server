import { createApp } from "@/app";
import { env } from "@/config/env";
import { logger } from "@/common/utils/logger";
import { checkDbConnection } from "@/db/knex";
import { reconcileUnsettledTrips } from "@/jobs/processors/settlement";

async function main() {
  const app = createApp();

  const dbOk = await checkDbConnection();
  if (!dbOk) {
    logger.warn("Could not reach the database on startup — check DATABASE_URL / docker-compose services. Continuing anyway.");
  }

  // Safety net: credit any completed trip whose settlement never ran (Redis outage, crash mid-request). Idempotent.
  if (dbOk) {
    void reconcileUnsettledTrips().catch((err) => logger.error({ err }, "startup reconcile failed"));
    setInterval(() => void reconcileUnsettledTrips().catch((err) => logger.error({ err }, "reconcile failed")), 5 * 60_000).unref();
  }

  app.listen(env.port, () => {
    logger.info(`Routta backend listening on http://localhost:${env.port}${env.apiPrefix}`);
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal error starting Routta backend");
  process.exit(1);
});
