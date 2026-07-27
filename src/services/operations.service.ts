import { Types, type QueryFilter } from "mongoose";

import type { IAuditLog } from "../models/audit/AuditLog.js";
import OutboxEvent, {
  type IOutboxEvent,
} from "../models/events/OutboxEvent.js";
import {
  getEventPublisher,
  hasEventPublisher,
} from "../ports/event-publisher.js";
import { operationsRepository } from "../repositories/operations.repository.js";
import type {
  AuditLogListQuery,
  OutboxListQuery,
} from "../validation/operations.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import { buildPaginationMeta } from "../utils/pagination.js";
import {
  isWorkerLeaseLostError,
  runWithLeaseHeartbeat,
} from "../utils/workerLease.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";

export const auditLogService = {
  async list(query: AuditLogListQuery) {
    const filter: QueryFilter<IAuditLog> = {};
    if (query.actorUserId) {
      filter.actorUserId = new Types.ObjectId(query.actorUserId);
    }
    if (query.actorType) filter.actorType = query.actorType;
    if (query.action) filter.action = query.action;
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = new Types.ObjectId(query.entityId);
    if (query.requestId) filter.requestId = query.requestId;
    if (query.occurredFrom || query.occurredTo) {
      filter.occurredAt = {
        ...(query.occurredFrom ? { $gte: query.occurredFrom } : {}),
        ...(query.occurredTo ? { $lt: query.occurredTo } : {}),
      };
    }
    const result = await operationsRepository.listAudit(
      filter,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, query),
    };
  },
};

export const outboxService = {
  async list(query: OutboxListQuery) {
    const filter: QueryFilter<IOutboxEvent> = {};
    if (query.status) filter.status = query.status;
    if (query.aggregateType) filter.aggregateType = query.aggregateType;
    if (query.aggregateId) {
      filter.aggregateId = new Types.ObjectId(query.aggregateId);
    }
    if (query.eventType) filter.eventType = query.eventType;
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { eventType: new RegExp(escaped, "i") },
        { eventId: new RegExp(escaped, "i") },
      ];
    }
    const result = await operationsRepository.listOutbox(
      filter,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, query),
    };
  },

  async retry(eventId: string, context: AuditActorContext) {
    const now = new Date();
    const event = await OutboxEvent.findOne({
      _id: eventId,
      $or: [
        { status: "failed" },
        { status: "processing", lockExpiresAt: { $lte: now } },
      ],
    });
    if (!event) {
      const exists = await OutboxEvent.exists({ _id: eventId });
      if (!exists) {
        throw ApiError.notFound(
          "Outbox event was not found",
          "OUTBOX_EVENT_NOT_FOUND",
        );
      }
      throw ApiError.conflict(
        "This outbox event is not retryable",
        undefined,
        "OUTBOX_EVENT_NOT_RETRYABLE",
      );
    }
    event.status = "pending";
    event.nextAttemptAt = new Date();
    event.lockedAt = undefined;
    event.lockedBy = undefined;
    event.lockExpiresAt = undefined;
    event.lastError = undefined;
    await event.save();
    await recordAudit({
      context,
      action: "outbox_event.retried",
      entityType: "OutboxEvent",
      entityId: event._id,
    });
    return event;
  },
};

export const claimAndPublishNextOutboxEvent = async (
  workerId: string,
  options: { leaseMs?: number; maxAttempts?: number } = {},
): Promise<
  "idle" | "published" | "retry_scheduled" | "failed" | "lease_lost"
> => {
  if (!hasEventPublisher()) return "idle";
  const now = new Date();
  const workerName = workerId.slice(0, 200);
  const leaseMs = options.leaseMs ?? 60_000;
  const maxAttempts = options.maxAttempts ?? 20;
  const event = await OutboxEvent.findOneAndUpdate(
    {
      attempts: { $lt: maxAttempts },
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
    },
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
    { new: true, sort: { createdAt: 1, _id: 1 } },
  ).select("+payload +lastError");
  if (!event) return "idle";

  try {
    const publisher = getEventPublisher();
    await runWithLeaseHeartbeat(
      () =>
        publisher.publish({
          eventId: event.eventId,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          eventType: event.eventType,
          payload: event.payload,
          occurredAt: event.createdAt,
        }),
      () => extendOutboxWorkerLease(event._id, workerName, leaseMs),
      leaseMs,
    );
    const completed = await OutboxEvent.updateOne(
      {
        _id: event._id,
        status: "processing",
        lockedBy: workerName,
      },
      {
        $set: { status: "published", publishedAt: new Date() },
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
    return "published";
  } catch (error) {
    if (isWorkerLeaseLostError(error)) return "lease_lost";
    const lastError =
      error instanceof Error ? error.message.slice(0, 2000) : "Unknown error";
    const terminal = event.attempts >= maxAttempts;
    const delaySeconds = Math.min(
      3600,
      2 ** Math.min(event.attempts, 10) * 5,
    );
    const failed = await OutboxEvent.updateOne(
      {
        _id: event._id,
        status: "processing",
        lockedBy: workerName,
      },
      {
        $set: {
          status: "failed",
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
    return terminal ? "failed" : "retry_scheduled";
  }
};

export const extendOutboxWorkerLease = async (
  eventId: Types.ObjectId | string,
  workerId: string,
  leaseMs = 60_000,
): Promise<boolean> => {
  const now = new Date();
  const result = await OutboxEvent.updateOne(
    {
      _id: eventId,
      status: "processing",
      lockedBy: workerId.slice(0, 200),
      lockExpiresAt: { $gt: now },
    },
    { $set: { lockExpiresAt: new Date(now.getTime() + leaseMs) } },
  );
  return result.modifiedCount === 1;
};
