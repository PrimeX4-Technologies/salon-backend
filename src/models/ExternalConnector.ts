import { Schema, type Types } from "mongoose";

import { getOrCreateModel, isSafeExternalHttpsUrl } from "./shared.js";

export const EXTERNAL_ENTITY_TYPES = [
  "customer",
  "service",
  "employee",
  "booking",
  "booking_payment",
  "calendar_block",
] as const;

export type ExternalEntityType = (typeof EXTERNAL_ENTITY_TYPES)[number];

interface IEntitySyncPolicy {
  entityType: ExternalEntityType;
  enabled: boolean;
  direction: "inbound" | "outbound" | "bidirectional";
  sourceOfTruth: "local" | "external" | "newest";
}

export interface IExternalConnector {
  salonId: Types.ObjectId;
  name: string;
  provider: string;
  type: "erp_pos" | "crm" | "calendar" | "custom";
  status: "disabled" | "active" | "degraded" | "revoked";
  baseUrl?: string;
  secretReference?: string;
  webhookSecretHash?: string;
  syncPolicies: IEntitySyncPolicy[];
  pollingIntervalMinutes?: number;
  cursor?: string;
  lastSuccessfulSyncAt?: Date;
  lastSyncAttemptAt?: Date;
  consecutiveFailures: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EntitySyncPolicySchema = new Schema<IEntitySyncPolicy>(
  {
    entityType: { type: String, enum: EXTERNAL_ENTITY_TYPES, required: true },
    enabled: { type: Boolean, default: true },
    direction: {
      type: String,
      enum: ["inbound", "outbound", "bidirectional"],
      default: "bidirectional",
    },
    sourceOfTruth: { type: String, enum: ["local", "external", "newest"], default: "external" },
  },
  { _id: false },
);

const ExternalConnectorSchema = new Schema<IExternalConnector>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    provider: { type: String, required: true, trim: true, lowercase: true, maxlength: 100 },
    type: { type: String, enum: ["erp_pos", "crm", "calendar", "custom"], required: true },
    status: {
      type: String,
      enum: ["disabled", "active", "degraded", "revoked"],
      default: "disabled",
    },
    baseUrl: {
      type: String,
      trim: true,
      maxlength: 2048,
      validate: {
        validator: isSafeExternalHttpsUrl,
        message: "Connector URL must be a public HTTPS URL without embedded credentials",
      },
    },
    secretReference: { type: String, trim: true, maxlength: 1000, select: false },
    webhookSecretHash: { type: String, trim: true, maxlength: 255, select: false },
    syncPolicies: { type: [EntitySyncPolicySchema], default: [] },
    pollingIntervalMinutes: { type: Number, min: 1, max: 43_200 },
    cursor: { type: String, maxlength: 4000, select: false },
    lastSuccessfulSyncAt: Date,
    lastSyncAttemptAt: Date,
    consecutiveFailures: { type: Number, default: 0, min: 0 },
    lastError: { type: String, trim: true, maxlength: 4000, select: false },
  },
  { timestamps: true, optimisticConcurrency: true },
);

ExternalConnectorSchema.index({ salonId: 1, name: 1 }, { unique: true });
ExternalConnectorSchema.index({ salonId: 1, provider: 1, status: 1 });

ExternalConnectorSchema.pre("validate", function () {
  this.syncPolicies = this.syncPolicies ?? [];
  const entityTypes = this.syncPolicies.map((policy) => policy.entityType);
  if (new Set(entityTypes).size !== entityTypes.length) {
    this.invalidate("syncPolicies", "An entity type can have only one sync policy");
  }

  const connectionConfigurationChanged =
    this.isNew || this.isModified("status") || this.isModified("secretReference");
  if (connectionConfigurationChanged && this.status === "active" && !this.secretReference) {
    this.invalidate("secretReference", "An active connector requires a secret-manager reference");
  }
});

const ExternalConnector = getOrCreateModel<IExternalConnector>(
  "ExternalConnector",
  ExternalConnectorSchema,
);

export { ExternalConnectorSchema };
export default ExternalConnector;
