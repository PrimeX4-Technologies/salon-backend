import { Schema, type Types } from "mongoose";

import { EXTERNAL_ENTITY_TYPES, type ExternalEntityType } from "./ExternalConnector.js";
import { getOrCreateModel } from "./shared.js";

export interface IExternalEntityMapping {
  salonId: Types.ObjectId;
  connectorId: Types.ObjectId;
  entityType: ExternalEntityType;
  localId: Types.ObjectId;
  externalId: string;
  origin: "local" | "external";
  sourceOfTruth: "local" | "external" | "newest";
  externalVersion?: string;
  localChecksum?: string;
  externalChecksum?: string;
  syncStatus: "pending" | "synced" | "conflict" | "failed" | "deleted_external";
  lastSyncedAt?: Date;
  lastAttemptAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ExternalEntityMappingSchema = new Schema<IExternalEntityMapping>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    connectorId: { type: Schema.Types.ObjectId, ref: "ExternalConnector", required: true },
    entityType: { type: String, enum: EXTERNAL_ENTITY_TYPES, required: true },
    localId: { type: Schema.Types.ObjectId, required: true },
    externalId: { type: String, required: true, trim: true, maxlength: 512 },
    origin: { type: String, enum: ["local", "external"], required: true },
    sourceOfTruth: { type: String, enum: ["local", "external", "newest"], required: true },
    externalVersion: { type: String, trim: true, maxlength: 512 },
    localChecksum: { type: String, trim: true, maxlength: 128 },
    externalChecksum: { type: String, trim: true, maxlength: 128 },
    syncStatus: {
      type: String,
      enum: ["pending", "synced", "conflict", "failed", "deleted_external"],
      default: "pending",
    },
    lastSyncedAt: Date,
    lastAttemptAt: Date,
    lastError: { type: String, trim: true, maxlength: 4000, select: false },
  },
  { timestamps: true, optimisticConcurrency: true },
);

ExternalEntityMappingSchema.index(
  { salonId: 1, connectorId: 1, entityType: 1, externalId: 1 },
  { unique: true, name: "unique_external_entity" },
);
ExternalEntityMappingSchema.index(
  { salonId: 1, connectorId: 1, entityType: 1, localId: 1 },
  { unique: true, name: "unique_local_entity" },
);
ExternalEntityMappingSchema.index({ connectorId: 1, syncStatus: 1, updatedAt: 1 });

const ExternalEntityMapping = getOrCreateModel<IExternalEntityMapping>(
  "ExternalEntityMapping",
  ExternalEntityMappingSchema,
);

export { ExternalEntityMappingSchema };
export default ExternalEntityMapping;
