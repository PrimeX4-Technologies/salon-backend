import { Router } from "express";

import {
  createConnector,
  enqueueSyncJob,
  getConnector,
  listConnectors,
  listMappings,
  listSyncJobs,
  resolveMappingConflict,
  retrySyncJob,
  setConnectorStatus,
  updateConnector,
  upsertMapping,
} from "../controllers/integration.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  authorizeRoles,
  requirePermissions,
} from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  connectorBodySchema,
  connectorIdParamsSchema,
  connectorListQuerySchema,
  connectorStatusBodySchema,
  mappingBodySchema,
  mappingIdParamsSchema,
  mappingListQuerySchema,
  resolveMappingConflictBodySchema,
  syncJobBodySchema,
  syncJobIdParamsSchema,
  syncJobListQuerySchema,
  updateConnectorBodySchema,
} from "../../validation/integration.schemas.js";

export const adminIntegrationRouter = Router();
adminIntegrationRouter.use(
  authenticate,
  authorizeRoles("admin", "employee"),
  requirePermissions("manage_integrations"),
);
adminIntegrationRouter.get(
  "/connectors",
  validate({ query: connectorListQuerySchema }),
  listConnectors,
);
adminIntegrationRouter.post(
  "/connectors",
  validate({ body: connectorBodySchema }),
  createConnector,
);
adminIntegrationRouter.get(
  "/connectors/:connectorId",
  validate({ params: connectorIdParamsSchema }),
  getConnector,
);
adminIntegrationRouter.patch(
  "/connectors/:connectorId",
  validate({
    params: connectorIdParamsSchema,
    body: updateConnectorBodySchema,
  }),
  updateConnector,
);
adminIntegrationRouter.put(
  "/connectors/:connectorId/status",
  validate({
    params: connectorIdParamsSchema,
    body: connectorStatusBodySchema,
  }),
  setConnectorStatus,
);
adminIntegrationRouter.get(
  "/connectors/:connectorId/mappings",
  validate({
    params: connectorIdParamsSchema,
    query: mappingListQuerySchema,
  }),
  listMappings,
);
adminIntegrationRouter.put(
  "/connectors/:connectorId/mappings",
  validate({
    params: connectorIdParamsSchema,
    body: mappingBodySchema,
  }),
  upsertMapping,
);
adminIntegrationRouter.post(
  "/connectors/:connectorId/mappings/:mappingId/resolve",
  validate({
    params: mappingIdParamsSchema,
    body: resolveMappingConflictBodySchema,
  }),
  resolveMappingConflict,
);
adminIntegrationRouter.get(
  "/connectors/:connectorId/sync-jobs",
  validate({
    params: connectorIdParamsSchema,
    query: syncJobListQuerySchema,
  }),
  listSyncJobs,
);
adminIntegrationRouter.post(
  "/connectors/:connectorId/sync-jobs",
  validate({
    params: connectorIdParamsSchema,
    body: syncJobBodySchema,
  }),
  enqueueSyncJob,
);
adminIntegrationRouter.post(
  "/connectors/:connectorId/sync-jobs/:syncJobId/retry",
  validate({ params: syncJobIdParamsSchema }),
  retrySyncJob,
);

