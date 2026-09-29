import { Router } from "express";
import { driversController } from "./drivers.controller";
import { requireAuth, requireUserType } from "@/common/middleware/auth";
import { validate } from "@/common/middleware/validate";
import * as v from "./drivers.validation";
import multer from "multer";
import { env } from "@/config/env";
import { ValidationError } from "@/common/utils/errors";

// Files are held in memory (size-capped), sniffed by magic bytes, then handed to the StorageProvider.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: env.storage.maxUploadBytes, files: 1 } });
function singleFile(req: any, res: any, next: any) {
  upload.single("file")(req, res, (err: any) => {
    if (!err) return next();
    next(new ValidationError(err.code === "LIMIT_FILE_SIZE" ? "File is too large." : "Could not read the uploaded file."));
  });
}

export const driversRouter = Router();

driversRouter.use(requireAuth, requireUserType("driver"));

driversRouter.get("/me", driversController.getMe);
driversRouter.patch("/me", validate(v.updateDriverProfileSchema), driversController.updateMe);
driversRouter.patch("/me/status", validate(v.updateOnlineStatusSchema), driversController.setOnline);
driversRouter.patch("/me/location", validate(v.reportLocationSchema), driversController.reportLocation);

driversRouter.get("/me/vehicle", driversController.getVehicle);
driversRouter.put("/me/vehicle", validate(v.upsertVehicleSchema), driversController.upsertVehicle);

driversRouter.get("/me/documents", driversController.listDocuments);
driversRouter.post("/me/documents/:key/upload", validate(v.documentKeyParamSchema, "params"), singleFile, driversController.uploadDocument);
driversRouter.post("/me/documents/:key/renew", validate(v.uploadDocumentSchema), driversController.uploadRenewal);

driversRouter.get("/me/earnings", validate(v.earningsPeriodQuerySchema, "query"), driversController.earningsPeriod);
driversRouter.get("/me/earnings/ledger", driversController.ledger);
driversRouter.get("/me/earnings/balance", driversController.availableBalance);
driversRouter.post("/me/payouts/quote", validate(v.payoutQuoteSchema), driversController.quotePayout);
driversRouter.post("/me/payouts", validate(v.requestPayoutSchema), driversController.confirmPayout);

driversRouter.get("/me/dashboard", driversController.dashboard);
driversRouter.get("/me/payout-account", driversController.getPayoutAccount);
driversRouter.put("/me/payout-account", validate(v.payoutAccountSchema), driversController.setPayoutAccount);
driversRouter.get("/me/settings", driversController.getSettings);
driversRouter.patch("/me/settings", validate(v.driverSettingsSchema), driversController.updateSettings);

driversRouter.get("/me/reviews", driversController.reviews);
