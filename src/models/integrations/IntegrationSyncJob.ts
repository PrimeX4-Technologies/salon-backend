import { randomUUID } from "node:crypto";

import { Schema, type Types } from "mongoose";

import { EXTERNAL_ENTITY_TYPES, type ExternalEntityType } from "./ExternalConnector.js";
import { getOrCreateModel } from "../core/shared.js";

export interface IIntegrationSyncJob {
  jobId: string;
  connectorId: Types.ObjectId;
  direction: "inbound" | "outbound";
  operation: "create" | "update" | "delete" | "reconcile";
  entityType: ExternalEntityType;
  localId?: Types.ObjectId;
  externalId?: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  status: "pending" | "processing" | "succeeded" | "failed" | "dead_letter";
  attempts: number;
  maxAttempts: number;
  nextAttemptAt?: Date;
  lockedAt?: Date;
  lockedBy?: string;
  completedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const IntegrationSyncJobSchema = new Schema<IIntegrationSyncJob>(
  {
    jobId: { type: String, required: true, default: () => randomUUID(), immutable: true },
    connectorId: { type: Schema.Types.ObjectId, ref: "ExternalConnector", required: true },
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    operation: { type: String, enum: ["create", "update", "delete", "reconcile"], required: true },
    entityType: { type: String, enum: EXTERNAL_ENTITY_TYPES, required: true },
    localId: { type: Schema.Types.ObjectId },
    externalId: { type: String, trim: true, maxlength: 512 },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 255, select: false },
    payload: { type: Schema.Types.Mixed, select: false },
    status: {
      type: String,
      enum: ["pending", "processing", "succeeded", "failed", "dead_letter"],
      default: "pending",
    },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 10, min: 1, max: 100 },
    nextAttemptAt: Date,
    lockedAt: Date,
    lockedBy: { type: String, trim: true, maxlength: 200 },
    completedAt: Date,
    lastError: { type: String, trim: true, maxlength: 4000, select: false },
  },
  { timestamps: true },
);

IntegrationSyncJobSchema.index({ jobId: 1 }, { unique: true });
IntegrationSyncJobSchema.index({ connectorId: 1, idempotencyKey: 1 }, { unique: true });
IntegrationSyncJobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });
IntegrationSyncJobSchema.index({ connectorId: 1, entityType: 1, localId: 1, createdAt: -1 });

IntegrationSyncJobSchema.pre("validate", function () {
  if (!this.localId && !this.externalId) {
    this.invalidate("localId", "A sync job requires a local ID or external ID");
  }
});

const IntegrationSyncJob = getOrCreateModel<IIntegrationSyncJob>(
  "IntegrationSyncJob",
  IntegrationSyncJobSchema,
);

export { IntegrationSyncJobSchema };
export default IntegrationSyncJob;
