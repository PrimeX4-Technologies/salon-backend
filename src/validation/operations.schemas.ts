import { z } from "zod";

import {
  instantSchema,
  objectIdSchema,
  paginationQuerySchema,
} from "./common.schemas.js";

export const auditLogListQuerySchema = paginationQuerySchema
  .extend({
    actorUserId: objectIdSchema.optional(),
    actorType: z.enum(["user", "system", "integration"]).optional(),
    action: z.string().trim().max(160).optional(),
    entityType: z.string().trim().max(100).optional(),
    entityId: objectIdSchema.optional(),
    requestId: z.string().trim().max(200).optional(),
    occurredFrom: instantSchema.optional(),
    occurredTo: instantSchema.optional(),
  })
  .strict();

export const outboxListQuerySchema = paginationQuerySchema
  .extend({
    status: z.enum(["pending", "processing", "published", "failed"]).optional(),
    aggregateType: z
      .enum([
        "booking",
        "booking_quote",
        "waitlist",
        "employee_schedule",
        "time_off",
        "booking_payment",
        "catalog",
        "user",
      ])
      .optional(),
    aggregateId: objectIdSchema.optional(),
    eventType: z.string().trim().max(160).optional(),
  })
  .strict();

export const outboxIdParamsSchema = z
  .object({ outboxEventId: objectIdSchema })
  .strict();

export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>;
export type OutboxListQuery = z.infer<typeof outboxListQuerySchema>;

