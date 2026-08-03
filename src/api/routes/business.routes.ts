import { Router } from "express";

import { businessController } from "../controllers/business.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { requireAllBranchAccess } from "../middlewares/business-access.middleware.js";
import {
  requireBranchAccess,
  requirePermissions,
  authorizeRoles,
} from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  branchCreateSchema,
  branchHoursCreateSchema,
  branchHoursIdParamsSchema,
  branchHoursListSchema,
  branchHoursUpdateSchema,
  branchIdParamsSchema,
  branchListSchema,
  branchUpdateSchema,
  businessBootstrapSchema,
  businessProfileUpdateSchema,
  businessSettingsUpdateSchema,
  currentBranchHoursSchema,
} from "../validators/business.validators.js";

export const adminBusinessRouter = Router();

adminBusinessRouter.use(authenticate);

adminBusinessRouter.post(
  "/business/bootstrap",
  authorizeRoles("admin"),
  requirePermissions("manage_business"),
  requireAllBranchAccess,
  validate({ body: businessBootstrapSchema.shape.body }),
  businessController.bootstrapBusiness,
);

adminBusinessRouter.get(
  "/business/profile",
  requirePermissions("manage_business"),
  businessController.getBusinessProfile,
);
adminBusinessRouter.put(
  "/business/profile",
  requirePermissions("manage_business"),
  requireAllBranchAccess,
  validate({ body: businessProfileUpdateSchema.shape.body }),
  businessController.updateBusinessProfile,
);

adminBusinessRouter.get(
  "/business/settings",
  requirePermissions("manage_settings"),
  businessController.getBusinessSettings,
);
adminBusinessRouter.put(
  "/business/settings",
  requirePermissions("manage_settings"),
  requireAllBranchAccess,
  validate({ body: businessSettingsUpdateSchema.shape.body }),
  businessController.updateBusinessSettings,
);

adminBusinessRouter.get(
  "/branches",
  requirePermissions("manage_branches"),
  validate({ query: branchListSchema.shape.query }),
  businessController.listBranches,
);
adminBusinessRouter.post(
  "/branches",
  requirePermissions("manage_branches"),
  requireAllBranchAccess,
  validate({ body: branchCreateSchema.shape.body }),
  businessController.createBranch,
);
adminBusinessRouter.get(
  "/branches/:branchId",
  requirePermissions("manage_branches"),
  validate({ params: branchIdParamsSchema.shape.params }),
  requireBranchAccess("branchId"),
  businessController.getBranch,
);
adminBusinessRouter.patch(
  "/branches/:branchId",
  requirePermissions("manage_branches"),
  requireAllBranchAccess,
  validate({
    params: branchUpdateSchema.shape.params,
    body: branchUpdateSchema.shape.body,
  }),
  businessController.updateBranch,
);
adminBusinessRouter.delete(
  "/branches/:branchId",
  requirePermissions("manage_branches"),
  requireAllBranchAccess,
  validate({ params: branchIdParamsSchema.shape.params }),
  businessController.archiveBranch,
);

adminBusinessRouter.get(
  "/branches/:branchId/hours",
  requirePermissions("manage_schedules"),
  validate({
    params: branchHoursListSchema.shape.params,
    query: branchHoursListSchema.shape.query,
  }),
  requireBranchAccess("branchId"),
  businessController.listBranchHours,
);
adminBusinessRouter.post(
  "/branches/:branchId/hours",
  requirePermissions("manage_schedules"),
  validate({
    params: branchHoursCreateSchema.shape.params,
    body: branchHoursCreateSchema.shape.body,
  }),
  requireBranchAccess("branchId"),
  businessController.createBranchHours,
);
adminBusinessRouter.get(
  "/branches/:branchId/hours/:hoursId",
  requirePermissions("manage_schedules"),
  validate({ params: branchHoursIdParamsSchema.shape.params }),
  requireBranchAccess("branchId"),
  businessController.getBranchHours,
);
adminBusinessRouter.patch(
  "/branches/:branchId/hours/:hoursId",
  requirePermissions("manage_schedules"),
  validate({
    params: branchHoursUpdateSchema.shape.params,
    body: branchHoursUpdateSchema.shape.body,
  }),
  requireBranchAccess("branchId"),
  businessController.updateBranchHours,
);
adminBusinessRouter.delete(
  "/branches/:branchId/hours/:hoursId",
  requirePermissions("manage_schedules"),
  validate({ params: branchHoursIdParamsSchema.shape.params }),
  requireBranchAccess("branchId"),
  businessController.archiveBranchHours,
);

export const publicBusinessRouter = Router();

publicBusinessRouter.get("/business", businessController.getPublicBusinessOverview);
publicBusinessRouter.get(
  "/branches",
  validate({ query: branchListSchema.shape.query }),
  businessController.listPublicBranches,
);
publicBusinessRouter.get(
  "/branches/:branchId",
  validate({ params: branchIdParamsSchema.shape.params }),
  businessController.getPublicBranch,
);
publicBusinessRouter.get(
  "/branches/:branchId/hours",
  validate({
    params: currentBranchHoursSchema.shape.params,
    query: currentBranchHoursSchema.shape.query,
  }),
  businessController.getCurrentPublicBranchHours,
);

export default adminBusinessRouter;
