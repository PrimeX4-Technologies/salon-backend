import { z } from "zod";

import {
  objectIdSchema,
  paginationQuerySchema,
} from "./common.schemas.js";

const providerSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
const entityTypeSchema = z.enum([
  "customer",
  "service",
  "product",
  "service_package",
  "employee",
  "branch",
  "booking",
  "booking_quote",
  "booking_payment",
  "calendar_block",
]);
const secretReferenceSchema = z
  .string()
  .trim()
  .min(6)
  .max(1000)
  .regex(
    /^(?:aws-secretsmanager|gcp-secretmanager|azure-keyvault|vault):\/\/[A-Za-z0-9._~!$&'()*+,;=:@%/?-]+$/,
    "Must be a supported secret-manager reference",
  );
const syncPolicySchema = z
  .object({
    entityType: entityTypeSchema,
    enabled: z.boolean().default(true),
    direction: z
      .enum(["inbound", "outbound", "bidirectional"])
      .default("bidirectional"),
    sourceOfTruth: z.enum(["local", "external", "newest"]).default("external"),
  })
  .strict();

export const connectorIdParamsSchema = z
  .object({ connectorId: objectIdSchema })
  .strict();
export const mappingIdParamsSchema = z
  .object({
    connectorId: objectIdSchema,
    mappingId: objectIdSchema,
  })
  .strict();
export const syncJobIdParamsSchema = z
  .object({
    connectorId: objectIdSchema,
    syncJobId: objectIdSchema,
  })
  .strict();

const connectorShape = {
    name: z.string().trim().min(2).max(120),
    provider: providerSchema,
    type: z.enum(["erp_pos", "crm", "calendar", "custom"]),
    scope: z.enum(["business", "branch"]),
    branchId: objectIdSchema.optional().nullable(),
    baseUrl: z.string().url().max(2048).optional().nullable(),
    secretReference: secretReferenceSchema.optional().nullable(),
    syncPolicies: z.array(syncPolicySchema).max(10),
    pollingIntervalMinutes: z.number().int().min(1).max(43_200).optional().nullable(),
};

const connectorObjectSchema = z
  .object({
    ...connectorShape,
    scope: connectorShape.scope.default("business"),
    syncPolicies: connectorShape.syncPolicies.default([]),
  })
  .strict();

const refineConnector = (
  value: {
    scope?: "business" | "branch";
    branchId?: string | null;
    syncPolicies?: Array<{ entityType: string }>;
  },
  context: z.RefinementCtx,
): void => {
    if (value.scope === "branch" && !value.branchId) {
      context.addIssue({
        code: "custom",
        path: ["branchId"],
        message: "A branch-scoped connector requires branchId",
      });
    }
    const types = (value.syncPolicies ?? []).map((policy) => policy.entityType);
    if (new Set(types).size !== types.length) {
      context.addIssue({
        code: "custom",
        path: ["syncPolicies"],
        message: "An entity type may have only one sync policy",
      });
    }
};

export const connectorBodySchema =
  connectorObjectSchema.superRefine(refineConnector);

export const updateConnectorBodySchema = z
  .object(connectorShape)
  .strict()
  .partial()
  .superRefine(refineConnector)
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one connector field is required",
  });

export const connectorStatusBodySchema = z
  .object({
    status: z.enum(["disabled", "active", "revoked"]),
  })
  .strict();

export const connectorListQuerySchema = paginationQuerySchema
  .extend({
    provider: providerSchema.optional(),
    type: z.enum(["erp_pos", "crm", "calendar", "custom"]).optional(),
    status: z.enum(["disabled", "active", "degraded", "revoked"]).optional(),
    scope: z.enum(["business", "branch"]).optional(),
    branchId: objectIdSchema.optional(),
  })
  .strict();

export const mappingBodySchema = z
  .object({
    entityType: entityTypeSchema,
    localId: objectIdSchema,
    externalId: z.string().trim().min(1).max(512),
    origin: z.enum(["local", "external"]),
    sourceOfTruth: z.enum(["local", "external", "newest"]),
    externalVersion: z.string().trim().max(512).optional().nullable(),
    localChecksum: z.string().trim().max(128).optional().nullable(),
    externalChecksum: z.string().trim().max(128).optional().nullable(),
  })
  .strict();

export const mappingListQuerySchema = paginationQuerySchema
  .extend({
    entityType: entityTypeSchema.optional(),
    syncStatus: z
      .enum(["pending", "synced", "conflict", "failed", "deleted_external"])
      .optional(),
    localId: objectIdSchema.optional(),
    externalId: z.string().trim().max(512).optional(),
  })
  .strict();

export const resolveMappingConflictBodySchema = z
  .object({
    sourceOfTruth: z.enum(["local", "external"]),
    idempotencyKey: z.string().trim().min(8).max(255),
  })
  .strict();

export const syncJobBodySchema = z
  .object({
    direction: z.enum(["inbound", "outbound"]),
    operation: z.enum(["create", "update", "delete", "reconcile"]),
    entityType: entityTypeSchema,
    localId: objectIdSchema.optional(),
    externalId: z.string().trim().min(1).max(512).optional(),
    idempotencyKey: z.string().trim().min(8).max(255),
    payload: z.record(z.string(), z.unknown()).optional(),
    maxAttempts: z.number().int().min(1).max(100).optional().default(10),
  })
  .strict()
  .refine((value) => Boolean(value.localId || value.externalId), {
    path: ["localId"],
    message: "A localId or externalId is required",
  });

export const syncJobListQuerySchema = paginationQuerySchema
  .extend({
    status: z
      .enum(["pending", "processing", "succeeded", "failed", "dead_letter"])
      .optional(),
    direction: z.enum(["inbound", "outbound"]).optional(),
    operation: z.enum(["create", "update", "delete", "reconcile"]).optional(),
    entityType: entityTypeSchema.optional(),
    localId: objectIdSchema.optional(),
  })
  .strict();

export type ConnectorBody = z.infer<typeof connectorBodySchema>;
export type UpdateConnectorBody = z.infer<typeof updateConnectorBodySchema>;
export type ConnectorStatusBody = z.infer<typeof connectorStatusBodySchema>;
export type ConnectorListQuery = z.infer<typeof connectorListQuerySchema>;
export type MappingBody = z.infer<typeof mappingBodySchema>;
export type MappingListQuery = z.infer<typeof mappingListQuerySchema>;
export type ResolveMappingConflictBody = z.infer<
  typeof resolveMappingConflictBodySchema
>;
export type SyncJobBody = z.infer<typeof syncJobBodySchema>;
export type SyncJobListQuery = z.infer<typeof syncJobListQuerySchema>;
