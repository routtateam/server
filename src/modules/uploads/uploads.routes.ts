import { Router } from "express";
import { requireAuth } from "@/common/middleware/auth";
import { asyncHandler } from "@/common/utils/asyncHandler";
import { ForbiddenError, NotFoundError } from "@/common/utils/errors";
import { db } from "@/db/knex";
import { env } from "@/config/env";
import { getStorage } from "@/integrations/storage";

// Authenticated file access. Uploaded KYC documents are private: there is NO public static mount of the upload
// directory. A file is served only to the document's owner (driver / their vehicle) or to an admin holding
// `verifications.view`.
export const filesRouter = Router();
filesRouter.use(requireAuth);

filesRouter.get(
  "/*",
  asyncHandler(async (req, res) => {
    const key = (req.params as any)[0] as string;
    if (!key || key.includes("..")) throw new NotFoundError("File not found");
    const url = `${env.apiPrefix}/files/${key}`;
    const doc = await db("documents").where({ file_url: url }).first();
    if (!doc) throw new NotFoundError("File not found");

    const user = req.user!;
    let allowed = false;
    if (user.userType === "admin") allowed = (user.permissions ?? []).includes("verifications.view");
    else if (doc.owner_type === "driver") allowed = doc.owner_id === user.id;
    else if (doc.owner_type === "vehicle") {
      const v = await db("vehicles").where({ id: doc.owner_id }).first();
      allowed = v?.driver_id === user.id;
    }
    if (!allowed) throw new ForbiddenError();

    const obj = await getStorage().get(key);
    if (!obj) throw new NotFoundError("File not found");
    res.setHeader("Content-Type", obj.contentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    res.send(obj.body);
  })
);
