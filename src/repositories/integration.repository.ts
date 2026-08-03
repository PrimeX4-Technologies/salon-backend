import type { QueryFilter } from "mongoose";

import ExternalConnector, {
  type IExternalConnector,
} from "../models/integrations/ExternalConnector.js";
import ExternalEntityMapping, {
  type IExternalEntityMapping,
} from "../models/integrations/ExternalEntityMapping.js";
import IntegrationSyncJob, {
  type IIntegrationSyncJob,
} from "../models/integrations/IntegrationSyncJob.js";

export const CONNECTOR_SAFE_SELECT =
  "name provider type scope branchId status baseUrl syncPolicies pollingIntervalMinutes lastSuccessfulSyncAt lastSyncAttemptAt consecutiveFailures createdAt updatedAt";
export const MAPPING_SAFE_SELECT =
  "connectorId entityType localId externalId origin sourceOfTruth externalVersion localChecksum externalChecksum syncStatus lastSyncedAt lastAttemptAt createdAt updatedAt";
export const SYNC_JOB_SAFE_SELECT =
  "jobId connectorId direction operation entityType localId externalId status attempts maxAttempts nextAttemptAt lockedAt lockExpiresAt completedAt createdAt updatedAt";

export const integrationRepository = {
  findConnector: (
    filter: QueryFilter<IExternalConnector>,
    includeOperationalSecrets = false,
  ) =>
    ExternalConnector.findOne(filter).select(
      includeOperationalSecrets
        ? `${CONNECTOR_SAFE_SELECT} +secretReference +lastError`
        : CONNECTOR_SAFE_SELECT,
    ),
  listConnectors: async (
    filter: QueryFilter<IExternalConnector>,
    skip: number,
    limit: number,
  ) => {
    const [items, total] = await Promise.all([
      ExternalConnector.find(filter)
        .select(CONNECTOR_SAFE_SELECT)
        .sort({ name: 1, _id: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ExternalConnector.countDocuments(filter),
    ]);
    return { items, total };
  },
  listMappings: async (
    filter: QueryFilter<IExternalEntityMapping>,
    skip: number,
    limit: number,
  ) => {
    const [items, total] = await Promise.all([
      ExternalEntityMapping.find(filter)
        .select(MAPPING_SAFE_SELECT)
        .sort({ updatedAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ExternalEntityMapping.countDocuments(filter),
    ]);
    return { items, total };
  },
  listJobs: async (
    filter: QueryFilter<IIntegrationSyncJob>,
    skip: number,
    limit: number,
  ) => {
    const [items, total] = await Promise.all([
      IntegrationSyncJob.find(filter)
        .select(SYNC_JOB_SAFE_SELECT)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      IntegrationSyncJob.countDocuments(filter),
    ]);
    return { items, total };
  },
};
