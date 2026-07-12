import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "./shared.js";

export interface IAuditLog {
  salonId: Types.ObjectId;
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
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
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

AuditLogSchema.index({ salonId: 1, occurredAt: -1 });
AuditLogSchema.index({ salonId: 1, actorUserId: 1, occurredAt: -1 });
AuditLogSchema.index({ salonId: 1, entityType: 1, entityId: 1, occurredAt: -1 });
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
