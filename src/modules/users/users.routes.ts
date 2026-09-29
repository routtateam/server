import { Router } from "express";
import { usersController } from "./users.controller";
import { requireAuth, requireUserType } from "@/common/middleware/auth";
import { validate } from "@/common/middleware/validate";
import * as v from "./users.validation";

export const usersRouter = Router();

usersRouter.use(requireAuth, requireUserType("commuter"));

usersRouter.get("/me", usersController.getMe);
usersRouter.patch("/me", validate(v.updateProfileSchema), usersController.updateMe);

usersRouter.delete("/me", usersController.deleteMe);

usersRouter.get("/me/places", usersController.listPlaces);
usersRouter.post("/me/places", validate(v.createPlaceSchema), usersController.createPlace);
usersRouter.delete("/me/places/:id", usersController.deletePlace);

usersRouter.get("/me/emergency-contacts", usersController.listEmergencyContacts);
usersRouter.post("/me/emergency-contacts", validate(v.createEmergencyContactSchema), usersController.createEmergencyContact);
usersRouter.delete("/me/emergency-contacts/:id", usersController.deleteEmergencyContact);
