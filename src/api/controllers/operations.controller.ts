import {
  auditLogService,
  outboxService,
} from "../../services/operations.service.js";
import type {
  AuditLogListQuery,
  OutboxListQuery,
} from "../../validation/operations.schemas.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { sendPaginated, sendSuccess } from "../../utils/httpResponse.js";
import {
  getAuditContext,
  getValidatedParam,
} from "./request-audit-context.js";

export const listAuditLogs = catchAsync(async (req, res) => {
  const result = await auditLogService.list(
    req.query as unknown as AuditLogListQuery,
  );
  sendPaginated(res, result.items, result.pagination);
});

export const listOutboxEvents = catchAsync(async (req, res) => {
  const result = await outboxService.list(
    req.query as unknown as OutboxListQuery,
  );
  sendPaginated(res, result.items, result.pagination);
});

export const retryOutboxEvent = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await outboxService.retry(
      getValidatedParam(req, "outboxEventId"),
      getAuditContext(req, res),
    ),
  );
});

