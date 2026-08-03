import type { QueryFilter } from "mongoose";

import AuditLog, { type IAuditLog } from "../models/audit/AuditLog.js";
import OutboxEvent, {
  type IOutboxEvent,
} from "../models/events/OutboxEvent.js";

export const AUDIT_SAFE_SELECT =
  "actorUserId actorType action entityType entityId requestId occurredAt createdAt";
export const OUTBOX_SAFE_SELECT =
  "eventId aggregateType aggregateId eventType status attempts nextAttemptAt lockedAt lockExpiresAt publishedAt createdAt updatedAt";

export const operationsRepository = {
  listAudit: async (
    filter: QueryFilter<IAuditLog>,
    skip: number,
    limit: number,
  ) => {
    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .select(AUDIT_SAFE_SELECT)
        .sort({ occurredAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);
    return { items, total };
  },
  listOutbox: async (
    filter: QueryFilter<IOutboxEvent>,
    skip: number,
    limit: number,
  ) => {
    const [items, total] = await Promise.all([
      OutboxEvent.find(filter)
        .select(OUTBOX_SAFE_SELECT)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      OutboxEvent.countDocuments(filter),
    ]);
    return { items, total };
  },
};
