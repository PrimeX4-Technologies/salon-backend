import type mongoose from "mongoose";
import { Types, type Model, type QueryFilter } from "mongoose";

import Branch from "../models/business/Branch.js";
import Booking from "../models/bookings/Booking.js";
import BookingQuote from "../models/bookings/BookingQuote.js";
import CalendarBlock from "../models/scheduling/CalendarBlock.js";
import Customer from "../models/customers/Customer.js";
import Employee from "../models/staff/Employee.js";
import Product from "../models/catalog/Product.js";
import Service from "../models/catalog/Service.js";
import ServicePackage from "../models/catalog/ServicePackage.js";
import BookingPayment from "../models/payments/BookingPayment.js";
import ExternalConnector, {
  type ExternalEntityType,
  type IExternalConnector,
} from "../models/integrations/ExternalConnector.js";
import ExternalEntityMapping, {
  type IExternalEntityMapping,
} from "../models/integrations/ExternalEntityMapping.js";
import IntegrationSyncJob, {
  type IIntegrationSyncJob,
} from "../models/integrations/IntegrationSyncJob.js";
import {
  getIntegrationAdapter,
  hasIntegrationAdapter,
  listConfiguredIntegrationProviders,
  type SafeConnectorConfiguration,
} from "../ports/integration-provider.js";
import {
  CONNECTOR_SAFE_SELECT,
  MAPPING_SAFE_SELECT,
  SYNC_JOB_SAFE_SELECT,
  integrationRepository,
} from "../repositories/integration.repository.js";
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
} from "../validation/integration.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import { buildPaginationMeta } from "../utils/pagination.js";
import { withTransaction } from "../utils/database.js";
import {
  isWorkerLeaseLostError,
  runWithLeaseHeartbeat,
} from "../utils/workerLease.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";
import {
  assertOperationalBranchAccess,
  type StaffBranchScope,
} from "./operational-access.js";

const entityModels: Record<ExternalEntityType, Model<unknown>> = {
  customer: Customer as Model<unknown>,
  service: Service as Model<unknown>,
  product: Product as Model<unknown>,
  service_package: ServicePackage as Model<unknown>,
  employee: Employee as Model<unknown>,
  branch: Branch as Model<unknown>,
  booking: Booking as Model<unknown>,
  booking_quote: BookingQuote as Model<unknown>,
  booking_payment: BookingPayment as Model<unknown>,
  calendar_block: CalendarBlock as Model<unknown>,
};

const toObjectId = (value: string): Types.ObjectId =>
  new Types.ObjectId(value);

const isDuplicateKey = (error: unknown): boolean =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000,
  );

const optionalString = (
  value: string | null | undefined,
): string | undefined => value ?? undefined;

const connectorToSafeConfiguration = (
  connector: mongoose.HydratedDocument<IExternalConnector>,
): SafeConnectorConfiguration => ({
  id: connector._id.toString(),
  name: connector.name,
  provider: connector.provider,
  type: connector.type,
  scope: connector.scope,
  branchId: connector.branchId?.toString(),
  baseUrl: connector.baseUrl,
  syncPolicies: connector.syncPolicies,
});

const assertConnectorAccess = (
  connector: Pick<IExternalConnector, "scope" | "branchId">,
  scope: StaffBranchScope,
): void => {
  if (connector.scope === "business") {
    if (!scope.allBranches) {
      throw ApiError.forbidden(
        "Business-wide connectors require access to every branch",
        "ALL_BRANCH_ACCESS_REQUIRED",
      );
    }
    return;
  }
  if (!connector.branchId) {
    throw new Error("Branch-scoped connector is missing branchId");
  }
  assertOperationalBranchAccess(scope, connector.branchId);
};

const assertRequestedConnectorScope = (
  connectorScope: "business" | "branch",
  branchId: string | null | undefined,
  scope: StaffBranchScope,
): void => {
  if (connectorScope === "business") {
    if (!scope.allBranches) {
      throw ApiError.forbidden(
        "Business-wide connectors require access to every branch",
        "ALL_BRANCH_ACCESS_REQUIRED",
      );
    }
    return;
  }
  if (!branchId) {
    throw ApiError.badRequest(
      "A branch-scoped connector requires branchId",
      undefined,
      "CONNECTOR_BRANCH_REQUIRED",
    );
  }
  assertOperationalBranchAccess(scope, branchId);
};

const requireConnector = async (
  connectorId: string,
  scope: StaffBranchScope,
  includeOperationalSecrets = false,
  session?: mongoose.ClientSession,
) => {
  const query = integrationRepository
    .findConnector(
      { _id: toObjectId(connectorId) },
      includeOperationalSecrets,
    )
    .session(session ?? null);
  const connector = await query;
  if (!connector) {
    throw ApiError.notFound("Connector was not found", "CONNECTOR_NOT_FOUND");
  }
  assertConnectorAccess(connector, scope);
  return connector;
};

const assertBranchExists = async (
  branchId: string | null | undefined,
): Promise<void> => {
  if (!branchId) return;
  const branch = await Branch.exists({ _id: branchId, isActive: true });
  if (!branch) {
    throw ApiError.badRequest(
      "Connector branch must be active",
      undefined,
      "INVALID_CONNECTOR_BRANCH",
    );
  }
};

const assertLocalEntityExists = async (
  entityType: ExternalEntityType,
  localId: string,
  session?: mongoose.ClientSession,
): Promise<void> => {
  const exists = await entityModels[entityType]
    .exists({ _id: localId })
    .session(session ?? null);
  if (!exists) {
    throw ApiError.badRequest(
      "localId does not reference an existing local entity",
      { entityType },
      "LOCAL_ENTITY_NOT_FOUND",
    );
  }
};

const assertConnectorMaySync = (
  connector: IExternalConnector,
  direction: "inbound" | "outbound",
  entityType: ExternalEntityType,
): void => {
  if (connector.status !== "active") {
    throw ApiError.conflict(
      "The connector must be active before sync jobs are queued",
      undefined,
      "CONNECTOR_NOT_ACTIVE",
    );
  }
  if (!hasIntegrationAdapter(connector.provider)) {
    throw new ApiError(503, "Integration adapter is not configured", {
      code: "INTEGRATION_ADAPTER_NOT_CONFIGURED",
      details: { provider: connector.provider },
      expose: true,
    });
  }
  const policy = connector.syncPolicies.find(
    (candidate) => candidate.entityType === entityType,
  );
  if (
    !policy?.enabled ||
    (policy.direction !== "bidirectional" && policy.direction !== direction)
  ) {
    throw ApiError.conflict(
      "The connector policy does not permit this sync direction",
      { entityType, direction },
      "SYNC_POLICY_FORBIDDEN",
    );
  }
};

const findSafeConnector = async (connectorId: Types.ObjectId) =>
  ExternalConnector.findById(connectorId).select(CONNECTOR_SAFE_SELECT).lean();

export const connectorService = {
  async list(query: ConnectorListQuery, scope: StaffBranchScope) {
    const filter: QueryFilter<IExternalConnector> = {};
    if (query.provider) filter.provider = query.provider;
    if (query.type) filter.type = query.type;
    if (query.status) filter.status = query.status;
    if (query.scope) filter.scope = query.scope;
    if (query.branchId) {
      assertOperationalBranchAccess(scope, query.branchId);
      filter.branchId = toObjectId(query.branchId);
    } else if (!scope.allBranches) {
      filter.scope = "branch";
      filter.branchId = { $in: scope.branchIds };
    }
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { name: new RegExp(escaped, "i") },
        { provider: new RegExp(escaped, "i") },
      ];
    }
    const result = await integrationRepository.listConnectors(
      filter,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, query),
    };
  },

  async get(connectorId: string, scope: StaffBranchScope) {
    const connector = await requireConnector(connectorId, scope);
    return connector;
  },

  async create(
    input: ConnectorBody,
    scope: StaffBranchScope,
    context: AuditActorContext,
  ) {
    assertRequestedConnectorScope(input.scope, input.branchId, scope);
    await assertBranchExists(input.branchId);
    const connector = new ExternalConnector({
      name: input.name,
      provider: input.provider,
      type: input.type,
      scope: input.scope,
      branchId:
        input.scope === "branch" && input.branchId
          ? toObjectId(input.branchId)
          : undefined,
      status: "disabled",
      baseUrl: optionalString(input.baseUrl),
      secretReference: optionalString(input.secretReference),
      syncPolicies: input.syncPolicies,
      pollingIntervalMinutes: input.pollingIntervalMinutes ?? undefined,
      consecutiveFailures: 0,
    });
    await connector.save();
    await recordAudit({
      context,
      action: "integration_connector.created",
      entityType: "ExternalConnector",
      entityId: connector._id,
      changes: {
        provider: connector.provider,
        type: connector.type,
        scope: connector.scope,
      },
    });
    return findSafeConnector(connector._id);
  },

  async update(
    connectorId: string,
    input: UpdateConnectorBody,
    scope: StaffBranchScope,
    context: AuditActorContext,
  ) {
    const connector = await requireConnector(connectorId, scope, true);
    if (connector.status === "revoked") {
      throw ApiError.conflict(
        "A revoked connector cannot be changed",
        undefined,
        "CONNECTOR_REVOKED",
      );
    }
    const nextScope = input.scope ?? connector.scope;
    const nextBranch =
      input.branchId !== undefined
        ? input.branchId
        : connector.branchId?.toString();
    assertRequestedConnectorScope(nextScope, nextBranch, scope);
    await assertBranchExists(nextScope === "branch" ? nextBranch : undefined);
    const connectionConfigurationChanged = [
      "provider",
      "type",
      "scope",
      "branchId",
      "baseUrl",
      "secretReference",
    ].some((field) => field in input);
    connector.set({
      ...input,
      branchId:
        nextScope === "branch" && nextBranch
          ? toObjectId(nextBranch)
          : undefined,
      baseUrl:
        input.baseUrl !== undefined
          ? optionalString(input.baseUrl)
          : connector.baseUrl,
      secretReference:
        input.secretReference !== undefined
          ? optionalString(input.secretReference)
          : connector.secretReference,
      pollingIntervalMinutes:
        input.pollingIntervalMinutes !== undefined
          ? input.pollingIntervalMinutes ?? undefined
          : connector.pollingIntervalMinutes,
    });
    if (connectionConfigurationChanged && connector.status === "active") {
      connector.status = "disabled";
    }
    await connector.save();
    await recordAudit({
      context,
      action: "integration_connector.updated",
      entityType: "ExternalConnector",
      entityId: connector._id,
      changes: { fields: Object.keys(input) },
    });
    return findSafeConnector(connector._id);
  },

  async setStatus(
    connectorId: string,
    input: ConnectorStatusBody,
    scope: StaffBranchScope,
    context: AuditActorContext,
  ) {
    const connector = await requireConnector(connectorId, scope, true);
    if (connector.status === "revoked" && input.status !== "revoked") {
      throw ApiError.conflict(
        "A revoked connector cannot be reactivated",
        undefined,
        "CONNECTOR_REVOKED",
      );
    }
    if (input.status === "active") {
      if (!connector.secretReference) {
        throw ApiError.conflict(
          "An active connector requires a secret-manager reference",
          undefined,
          "CONNECTOR_SECRET_REFERENCE_REQUIRED",
        );
      }
      const adapter = getIntegrationAdapter(connector.provider);
      await adapter.testConnection({
        connector: connectorToSafeConfiguration(connector),
        secretReference: connector.secretReference,
      });
      connector.consecutiveFailures = 0;
      connector.lastError = undefined;
      connector.lastSyncAttemptAt = new Date();
    }
    connector.status = input.status;
    await connector.save();
    await recordAudit({
      context,
      action: `integration_connector.${input.status}`,
      entityType: "ExternalConnector",
      entityId: connector._id,
    });
    return findSafeConnector(connector._id);
  },
};

export const mappingService = {
  async list(
    connectorId: string,
    query: MappingListQuery,
    scope: StaffBranchScope,
  ) {
    await requireConnector(connectorId, scope);
    const filter: QueryFilter<IExternalEntityMapping> = {
      connectorId: toObjectId(connectorId),
    };
    if (query.entityType) filter.entityType = query.entityType;
    if (query.syncStatus) filter.syncStatus = query.syncStatus;
    if (query.localId) filter.localId = toObjectId(query.localId);
    if (query.externalId) filter.externalId = query.externalId;
    const result = await integrationRepository.listMappings(
      filter,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, query),
    };
  },

  async upsert(
    connectorId: string,
    input: MappingBody,
    scope: StaffBranchScope,
    context: AuditActorContext,
  ) {
    const connector = await requireConnector(connectorId, scope);
    const policy = connector.syncPolicies.find(
      (candidate) => candidate.entityType === input.entityType,
    );
    if (!policy) {
      throw ApiError.conflict(
        "The connector has no policy for this entity type",
        undefined,
        "SYNC_POLICY_MISSING",
      );
    }
    await assertLocalEntityExists(input.entityType, input.localId);
    try {
      const mapping = await ExternalEntityMapping.findOneAndUpdate(
        {
          connectorId: connector._id,
          entityType: input.entityType,
          localId: toObjectId(input.localId),
        },
        {
          $set: {
            externalId: input.externalId,
            origin: input.origin,
            sourceOfTruth: input.sourceOfTruth,
            externalVersion: optionalString(input.externalVersion),
            localChecksum: optionalString(input.localChecksum),
            externalChecksum: optionalString(input.externalChecksum),
            syncStatus: "pending",
            lastError: undefined,
          },
          $setOnInsert: { connectorId: connector._id },
        },
        { new: true, upsert: true, runValidators: true },
      ).select(MAPPING_SAFE_SELECT);
      await recordAudit({
        context,
        action: "integration_mapping.upserted",
        entityType: "ExternalEntityMapping",
        entityId: mapping._id,
        changes: { entityType: input.entityType },
      });
      return mapping;
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw ApiError.conflict(
          "The local or external entity is already mapped differently",
          undefined,
          "INTEGRATION_MAPPING_CONFLICT",
        );
      }
      throw error;
    }
  },

  async resolveConflict(
    connectorId: string,
    mappingId: string,
    input: ResolveMappingConflictBody,
    scope: StaffBranchScope,
    context: AuditActorContext,
  ) {
    return withTransaction(async (session) => {
      const connector = await requireConnector(
        connectorId,
        scope,
        true,
        session,
      );
      const mapping = await ExternalEntityMapping.findOne({
        _id: mappingId,
        connectorId: connector._id,
      }).session(session);
      if (!mapping) {
        throw ApiError.notFound("Mapping was not found", "MAPPING_NOT_FOUND");
      }
      const direction =
        input.sourceOfTruth === "local" ? "outbound" : "inbound";
      const idempotentJob = await IntegrationSyncJob.findOne({
        connectorId: connector._id,
        idempotencyKey: input.idempotencyKey,
      })
        .select(`${SYNC_JOB_SAFE_SELECT} +idempotencyKey`)
        .session(session);
      if (idempotentJob) {
        if (
          idempotentJob.operation !== "reconcile" ||
          idempotentJob.direction !== direction ||
          idempotentJob.entityType !== mapping.entityType ||
          idempotentJob.localId?.toString() !== mapping.localId.toString() ||
          idempotentJob.externalId !== mapping.externalId
        ) {
          throw ApiError.conflict(
            "The idempotency key was already used for another resolution",
            undefined,
            "IDEMPOTENCY_KEY_REUSED",
          );
        }
        return { mapping, job: idempotentJob };
      }
      if (mapping.syncStatus !== "conflict") {
        throw ApiError.conflict(
          "Only conflicted mappings require resolution",
          undefined,
          "MAPPING_NOT_CONFLICTED",
        );
      }
      assertConnectorMaySync(connector, direction, mapping.entityType);
      mapping.sourceOfTruth = input.sourceOfTruth;
      mapping.syncStatus = "pending";
      mapping.lastError = undefined;
      await mapping.save({ session });
      const [job] = await IntegrationSyncJob.create(
        [
          {
            connectorId: connector._id,
            direction,
            operation: "reconcile",
            entityType: mapping.entityType,
            localId: mapping.localId,
            externalId: mapping.externalId,
            idempotencyKey: input.idempotencyKey,
            status: "pending",
          },
        ],
        { session },
      );
      await recordAudit(
        {
          context,
          action: "integration_mapping.conflict_resolved",
          entityType: "ExternalEntityMapping",
          entityId: mapping._id,
          changes: {
            sourceOfTruth: input.sourceOfTruth,
            syncJobId: job._id.toString(),
          },
        },
        session,
      );
      return { mapping, job };
    });
  },
};

const assertIdempotentJobMatch = (
  existing: IIntegrationSyncJob,
  input: SyncJobBody,
): void => {
  if (
    existing.direction !== input.direction ||
    existing.operation !== input.operation ||
    existing.entityType !== input.entityType ||
    (existing.localId?.toString() ?? undefined) !== input.localId ||
    (existing.externalId ?? undefined) !== input.externalId
  ) {
    throw ApiError.conflict(
      "The idempotency key was already used for a different sync job",
      undefined,
      "IDEMPOTENCY_KEY_REUSED",
    );
  }
};

export const syncJobService = {
  async enqueue(
    connectorId: string,
    input: SyncJobBody,
    scope: StaffBranchScope,
    context: AuditActorContext,
  ) {
    const connector = await requireConnector(connectorId, scope, true);
    assertConnectorMaySync(connector, input.direction, input.entityType);
    if (input.localId) {
      await assertLocalEntityExists(input.entityType, input.localId);
    }
    const existing = await IntegrationSyncJob.findOne({
      connectorId: connector._id,
      idempotencyKey: input.idempotencyKey,
    }).select(`${SYNC_JOB_SAFE_SELECT} +idempotencyKey`);
    if (existing) {
      assertIdempotentJobMatch(existing, input);
      return existing;
    }
    try {
      const job = await IntegrationSyncJob.create({
        connectorId: connector._id,
        direction: input.direction,
        operation: input.operation,
        entityType: input.entityType,
        localId: input.localId ? toObjectId(input.localId) : undefined,
        externalId: input.externalId,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        status: "pending",
        attempts: 0,
        maxAttempts: input.maxAttempts,
      });
      await recordAudit({
        context,
        action: "integration_sync_job.enqueued",
        entityType: "IntegrationSyncJob",
        entityId: job._id,
        changes: {
          connectorId: connector._id.toString(),
          direction: input.direction,
          entityType: input.entityType,
        },
      });
      return job;
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const raced = await IntegrationSyncJob.findOne({
        connectorId: connector._id,
        idempotencyKey: input.idempotencyKey,
      }).select(`${SYNC_JOB_SAFE_SELECT} +idempotencyKey`);
      if (!raced) throw error;
      assertIdempotentJobMatch(raced, input);
      return raced;
    }
  },

  async list(
    connectorId: string,
    query: SyncJobListQuery,
    scope: StaffBranchScope,
  ) {
    await requireConnector(connectorId, scope);
    const filter: QueryFilter<IIntegrationSyncJob> = {
      connectorId: toObjectId(connectorId),
    };
    if (query.status) filter.status = query.status;
    if (query.direction) filter.direction = query.direction;
    if (query.operation) filter.operation = query.operation;
    if (query.entityType) filter.entityType = query.entityType;
    if (query.localId) filter.localId = toObjectId(query.localId);
    const result = await integrationRepository.listJobs(
      filter,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, query),
    };
  },

  async retry(
    connectorId: string,
    jobId: string,
    scope: StaffBranchScope,
    context: AuditActorContext,
  ) {
    const connector = await requireConnector(connectorId, scope, true);
    const job = await IntegrationSyncJob.findOne({
      _id: jobId,
      connectorId: connector._id,
    });
    if (!job) {
      throw ApiError.notFound("Sync job was not found", "SYNC_JOB_NOT_FOUND");
    }
    if (!["failed", "dead_letter"].includes(job.status)) {
      throw ApiError.conflict(
        "Only failed or dead-letter jobs can be retried",
        undefined,
        "SYNC_JOB_NOT_RETRYABLE",
      );
    }
    assertConnectorMaySync(connector, job.direction, job.entityType);
    job.status = "pending";
    job.attempts = 0;
    job.nextAttemptAt = new Date();
    job.lockedAt = undefined;
    job.lockedBy = undefined;
    job.lockExpiresAt = undefined;
    job.completedAt = undefined;
    job.lastError = undefined;
    await job.save();
    await recordAudit({
      context,
      action: "integration_sync_job.retried",
      entityType: "IntegrationSyncJob",
      entityId: job._id,
    });
    return job;
  },
};

export const claimAndRunNextIntegrationJob = async (
  workerId: string,
  options: { leaseMs?: number } = {},
): Promise<
  "idle" | "succeeded" | "retry_scheduled" | "dead_letter" | "lease_lost"
> => {
  const configuredProviders = listConfiguredIntegrationProviders();
  if (configuredProviders.length === 0) return "idle";
  const eligibleConnectorIds = (await ExternalConnector.distinct("_id", {
    provider: { $in: configuredProviders },
    status: { $in: ["active", "degraded"] },
  })) as Types.ObjectId[];
  if (eligibleConnectorIds.length === 0) return "idle";
  const now = new Date();
  const workerName = workerId.slice(0, 200);
  const leaseMs = options.leaseMs ?? 10 * 60_000;
  const claimFilter: QueryFilter<IIntegrationSyncJob> = {
    $expr: { $lt: ["$attempts", "$maxAttempts"] },
    connectorId: { $in: eligibleConnectorIds },
    $or: [
      {
        status: { $in: ["pending", "failed"] },
        $and: [
          {
            $or: [
              { nextAttemptAt: { $exists: false } },
              { nextAttemptAt: { $lte: now } },
            ],
          },
        ],
      },
      { status: "processing", lockExpiresAt: { $lte: now } },
    ],
  };
  const job = await IntegrationSyncJob.findOneAndUpdate(
    claimFilter,
    {
      $set: {
        status: "processing",
        lockedAt: now,
        lockedBy: workerName,
        lockExpiresAt: new Date(now.getTime() + leaseMs),
      },
      $inc: { attempts: 1 },
      $unset: { lastError: 1 },
    },
    {
      new: true,
      includeResultMetadata: false,
      sort: { createdAt: 1, _id: 1 },
    },
  ).select("+payload +lastError");
  if (!job) return "idle";

  const connector = await integrationRepository.findConnector(
    { _id: job.connectorId },
    true,
  );
  try {
    if (
      !connector ||
      !["active", "degraded"].includes(connector.status) ||
      !connector.secretReference
    ) {
      throw new Error("Active connector configuration is unavailable");
    }
    const adapter = getIntegrationAdapter(connector.provider);
    await runWithLeaseHeartbeat(
      () =>
        adapter.runJob({
          connector: connectorToSafeConfiguration(connector),
          secretReference: connector.secretReference as string,
          job: {
            jobId: job.jobId,
            direction: job.direction,
            operation: job.operation,
            entityType: job.entityType,
            localId: job.localId,
            externalId: job.externalId,
            payload: job.payload,
          },
        }),
      () => extendIntegrationJobLease(job._id, workerName, leaseMs),
      leaseMs,
    );
    const completedAt = new Date();
    const completed = await IntegrationSyncJob.updateOne(
      {
        _id: job._id,
        status: "processing",
        lockedBy: workerName,
      },
      {
        $set: { status: "succeeded", completedAt },
        $unset: {
          nextAttemptAt: 1,
          lockedAt: 1,
          lockedBy: 1,
          lockExpiresAt: 1,
          lastError: 1,
        },
      },
    );
    if (completed.modifiedCount !== 1) return "lease_lost";
    connector.consecutiveFailures = 0;
    connector.lastError = undefined;
    connector.lastSuccessfulSyncAt = new Date();
    connector.lastSyncAttemptAt = new Date();
    connector.status = "active";
    await connector.save().catch(() => undefined);
    return "succeeded";
  } catch (error) {
    if (isWorkerLeaseLostError(error)) return "lease_lost";
    const lastError =
      error instanceof Error ? error.message.slice(0, 4000) : "Unknown error";
    const terminal = job.attempts >= job.maxAttempts;
    const delaySeconds = Math.min(21_600, 2 ** Math.min(job.attempts, 12) * 15);
    const failed = await IntegrationSyncJob.updateOne(
      {
        _id: job._id,
        status: "processing",
        lockedBy: workerName,
      },
      {
        $set: {
          status: terminal ? "dead_letter" : "failed",
          lastError,
          ...(terminal
            ? {}
            : {
                nextAttemptAt: new Date(
                  Date.now() + delaySeconds * 1000,
                ),
              }),
        },
        $unset: {
          ...(terminal ? { nextAttemptAt: 1 } : {}),
          lockedAt: 1,
          lockedBy: 1,
          lockExpiresAt: 1,
        },
      },
    );
    if (failed.modifiedCount !== 1) return "lease_lost";
    if (connector) {
      connector.consecutiveFailures += 1;
      connector.lastSyncAttemptAt = new Date();
      connector.lastError = lastError;
      if (
        connector.status === "active" &&
        connector.consecutiveFailures >= 3
      ) {
        connector.status = "degraded";
      }
      await connector.save().catch(() => undefined);
    }
    return terminal ? "dead_letter" : "retry_scheduled";
  }
};

export const extendIntegrationJobLease = async (
  jobId: Types.ObjectId | string,
  workerId: string,
  leaseMs = 10 * 60_000,
): Promise<boolean> => {
  const now = new Date();
  const result = await IntegrationSyncJob.updateOne(
    {
      _id: jobId,
      status: "processing",
      lockedBy: workerId.slice(0, 200),
      lockExpiresAt: { $gt: now },
    },
    { $set: { lockExpiresAt: new Date(now.getTime() + leaseMs) } },
  );
  return result.modifiedCount === 1;
};
