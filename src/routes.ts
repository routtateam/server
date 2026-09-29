// The API Gateway layer: a single Express Router that mounts every feature
// module's routes under its own path segment. app.ts mounts this whole
// router once at env.apiPrefix ("/api/v1"), so every module is versioned
// together. This is the seam that would become a real API gateway service
// boundary later — kept as a lightweight in-process router here since the
// project is explicitly a modular monolith, not microservices.
import { Router } from "express";
import { authRouter } from "@/modules/auth/auth.routes";
import { usersRouter } from "@/modules/users/users.routes";
import { driversRouter } from "@/modules/drivers/drivers.routes";
import { tripsRouter } from "@/modules/trips/trips.routes";
import { paymentsRouter } from "@/modules/payments/payments.routes";
import { premiumRouter, premiumBusinessRouter } from "@/modules/premium-business/premium.routes";
import { adminRouter } from "@/modules/admin/admin.routes";
import { notificationsRouter } from "@/modules/notifications/notifications.routes";
import { placesRouter } from "@/modules/places/places.routes";
import { filesRouter } from "@/modules/uploads/uploads.routes";
import { supportRouter } from "@/modules/support/support.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/drivers", driversRouter);
apiRouter.use("/trips", tripsRouter);
apiRouter.use("/payments", paymentsRouter);
apiRouter.use("/premium", premiumRouter);
apiRouter.use("/premium-business", premiumBusinessRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/notifications", notificationsRouter);
apiRouter.use("/places", placesRouter);
apiRouter.use("/files", filesRouter);
apiRouter.use("/support", supportRouter);
