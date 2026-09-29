import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import { env } from "@/config/env";
import { apiRouter } from "@/routes";
import { errorHandler, notFoundHandler } from "@/common/middleware/errorHandler";
import { registerJobEventSubscriptions } from "@/jobs";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins.includes("*") ? true : env.corsOrigins,
      credentials: true,
    })
  );
  app.use(compression());
  app.use(morgan(env.isProduction ? "combined" : "dev"));

  // NOTE: the Monnify webhook route (mounted inside paymentsRouter) needs the
  // *raw* request body for signature verification, so it registers its own
  // `express.raw()` middleware ahead of this global json() parser on that
  // one path. Every other route gets parsed JSON as usual.
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "routta-backend", time: new Date().toISOString() });
  });

  app.use(env.apiPrefix, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  registerJobEventSubscriptions();

  return app;
}
