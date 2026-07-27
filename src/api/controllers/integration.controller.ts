import {
  connectorService,
  mappingService,
  syncJobService,
} from "../../services/integration.service.js";
import type {
  ConnectorBody,
  ConnectorListQuery,
  ConnectorStatusBody,
  MappingBody,
  MappingListQuery,
  ResolveMappingConflictBody,
  SyncJobBody,
  SyncJobListQuery,
  UpdateConnectorBody,
} from "../../validation/integration.schemas.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  sendCreated,
  sendPaginated,
  sendSuccess,
} from "../../utils/httpResponse.js";
import {
  getAuditContext,
  getValidatedParam,
} from "./request-audit-context.js";
import { getOperationalStaffScope } from "./operational-context.js";

export const listConnectors = catchAsync(async (req, res) => {
  const result = await connectorService.list(
    req.query as unknown as ConnectorListQuery,
    getOperationalStaffScope(res),
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getConnector = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await connectorService.get(
      getValidatedParam(req, "connectorId"),
      getOperationalStaffScope(res),
    ),
  );
});

export const createConnector = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await connectorService.create(
      req.body as ConnectorBody,
      getOperationalStaffScope(res),
      getAuditContext(req, res),
    ),
  );
});

export const updateConnector = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await connectorService.update(
      getValidatedParam(req, "connectorId"),
      req.body as UpdateConnectorBody,
      getOperationalStaffScope(res),
      getAuditContext(req, res),
    ),
  );
});

export const setConnectorStatus = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await connectorService.setStatus(
      getValidatedParam(req, "connectorId"),
      req.body as ConnectorStatusBody,
      getOperationalStaffScope(res),
      getAuditContext(req, res),
    ),
  );
});

export const listMappings = catchAsync(async (req, res) => {
  const result = await mappingService.list(
    getValidatedParam(req, "connectorId"),
    req.query as unknown as MappingListQuery,
    getOperationalStaffScope(res),
  );
  sendPaginated(res, result.items, result.pagination);
});

export const upsertMapping = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await mappingService.upsert(
      getValidatedParam(req, "connectorId"),
      req.body as MappingBody,
      getOperationalStaffScope(res),
      getAuditContext(req, res),
    ),
  );
});

export const resolveMappingConflict = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await mappingService.resolveConflict(
      getValidatedParam(req, "connectorId"),
      getValidatedParam(req, "mappingId"),
      req.body as ResolveMappingConflictBody,
      getOperationalStaffScope(res),
      getAuditContext(req, res),
    ),
  );
});

export const enqueueSyncJob = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await syncJobService.enqueue(
      getValidatedParam(req, "connectorId"),
      req.body as SyncJobBody,
      getOperationalStaffScope(res),
      getAuditContext(req, res),
    ),
  );
});

export const listSyncJobs = catchAsync(async (req, res) => {
  const result = await syncJobService.list(
    getValidatedParam(req, "connectorId"),
    req.query as unknown as SyncJobListQuery,
    getOperationalStaffScope(res),
  );
  sendPaginated(res, result.items, result.pagination);
});

export const retrySyncJob = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await syncJobService.retry(
      getValidatedParam(req, "connectorId"),
      getValidatedParam(req, "syncJobId"),
      getOperationalStaffScope(res),
      getAuditContext(req, res),
    ),
  );
});

