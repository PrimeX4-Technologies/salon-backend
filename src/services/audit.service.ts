import type { ClientSession, Types } from "mongoose";

import AuditLog, { type IAuditLog } from "../models/audit/AuditLog.js";

export interface AuditActorContext {
  actorUserId?: Types.ObjectId | string;
  actorType?: IAuditLog["actorType"];
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface RecordAuditInput {
  context: AuditActorContext;
  action: string;
  entityType: string;
  entityId?: Types.ObjectId;
  changes?: Record<string, unknown>;
}

export const recordAudit = async (
  input: RecordAuditInput,
  session?: ClientSession,
): Promise<void> => {
  const record: Omit<IAuditLog, "createdAt"> = {
    ...(input.context.actorUserId
      ? { actorUserId: input.context.actorUserId as Types.ObjectId }
      : {}),
    actorType: input.context.actorType ?? "user",
    action: input.action,
    entityType: input.entityType,
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.context.requestId
      ? { requestId: input.context.requestId.slice(0, 200) }
      : {}),
    ...(input.context.ipAddress
      ? { ipAddress: input.context.ipAddress.slice(0, 64) }
      : {}),
    ...(input.context.userAgent
      ? { userAgent: input.context.userAgent.slice(0, 1000) }
      : {}),
    ...(input.changes ? { changes: input.changes } : {}),
    occurredAt: new Date(),
  };

  if (session) {
    await AuditLog.create([record], { session });
    return;
  }

  await AuditLog.create(record);
};
