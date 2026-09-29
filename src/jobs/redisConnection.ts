import { env } from "@/config/env";

/** Shared BullMQ connection options. BullMQ manages its own ioredis client
 *  internally from these options — we don't hand it a live client so both
 *  the API process (producers) and the worker process (consumers) can each
 *  own their own connection lifecycle. */
export const redisConnection = env.redis.url
  ? { url: env.redis.url }
  : {
      host: env.redis.host,
      port: env.redis.port,
      password: env.redis.password,
    };

export const defaultQueueOptions = {
  connection: redisConnection as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 5000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 1000 },
  },
};
