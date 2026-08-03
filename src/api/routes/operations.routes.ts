import { Router } from "express";

import {
  listAuditLogs,
  listOutboxEvents,
  retryOutboxEvent,
} from "../controllers/operations.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { requireAllBranchAccess } from "../middlewares/business-access.middleware.js";
import {
  authorizeRoles,
  requirePermissions,
} from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  auditLogListQuerySchema,
  outboxIdParamsSchema,
  outboxListQuerySchema,
} from "../../validation/operations.schemas.js";

export const adminAuditRouter = Router();
adminAuditRouter.use(
  authenticate,
  authorizeRoles("admin"),
  requirePermissions("manage_settings"),
  requireAllBranchAccess,
);
adminAuditRouter.get(
  "/",
  validate({ query: auditLogListQuerySchema }),
  listAuditLogs,
);

export const adminOutboxRouter = Router();
adminOutboxRouter.use(
  authenticate,
  authorizeRoles("admin"),
  requirePermissions("manage_integrations"),
  requireAllBranchAccess,
);
adminOutboxRouter.get(
  "/",
  validate({ query: outboxListQuerySchema }),
  listOutboxEvents,
);
adminOutboxRouter.post(
  "/:outboxEventId/retry",
  validate({ params: outboxIdParamsSchema }),
  retryOutboxEvent,
);

