import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "../core/shared.js";

export interface IAuditLog {
  actorUserId?: Types.ObjectId;
  actorType: "user" | "system" | "integration";
  action: string;
  entityType: string;
  entityId?: Types.ObjectId;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  changes?: Record<string, unknown>;
  occurredAt: Date;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: "User" },
    actorType: { type: String, enum: ["user", "system", "integration"], required: true },
    action: { type: String, required: true, trim: true, maxlength: 160 },
    entityType: { type: String, required: true, trim: true, maxlength: 100 },
    entityId: { type: Schema.Types.ObjectId },
    requestId: { type: String, trim: true, maxlength: 200 },
    ipAddress: { type: String, trim: true, maxlength: 64, select: false },
    userAgent: { type: String, trim: true, maxlength: 1000, select: false },
    changes: { type: Schema.Types.Mixed, select: false },
    occurredAt: { type: Date, required: true, default: Date.now, immutable: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    strict: "throw",
  },
);

AuditLogSchema.index({ occurredAt: -1 });
AuditLogSchema.index({ actorUserId: 1, occurredAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, occurredAt: -1 });
AuditLogSchema.index({ requestId: 1 });

const rejectAuditMutation = (): never => {
  throw new Error("Audit logs are append-only and cannot be changed or deleted");
};

AuditLogSchema.pre("save", function () {
  if (!this.isNew) rejectAuditMutation();
});
AuditLogSchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ],
  rejectAuditMutation,
);
AuditLogSchema.pre("deleteOne", { document: true, query: false }, rejectAuditMutation);
AuditLogSchema.pre("bulkWrite", rejectAuditMutation);

const AuditLog = getOrCreateModel<IAuditLog>("AuditLog", AuditLogSchema);

export { AuditLogSchema };
export default AuditLog;
