import type { Request } from "express";

import {
  ingestPaymentWebhook,
  paymentService,
  paymentWebhookOperationsService,
} from "../../services/payment.service.js";
import type {
  CreateAdvanceCheckoutBody,
  CustomerPaymentListQuery,
  PaymentListQuery,
  RecordAdvanceBody,
  RecordRefundBody,
  WebhookEventListQuery,
} from "../../validation/payment.schemas.js";
import { ApiError } from "../../utils/ApiError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  sendCreated,
  sendPaginated,
  sendSuccess,
} from "../../utils/httpResponse.js";
import {
  getAuditContext,
  getValidatedParam,
} from "./request-audit-context.js";
import {
  getIdempotencyKey,
  getOperationalStaffScope,
  requireOperationalAuth,
} from "./operational-context.js";

export const listMyPayments = catchAsync(async (req, res) => {
  const auth = requireOperationalAuth(req);
  const result = await paymentService.listForCustomer(
    auth.userId,
    req.query as unknown as CustomerPaymentListQuery,
  );
  sendPaginated(res, result.items, result.pagination);
});

export const createMyAdvanceCheckout = catchAsync(async (req, res) => {
  const auth = requireOperationalAuth(req);
  sendCreated(
    res,
    await paymentService.createAdvanceCheckout(
      auth.userId,
      req.body as CreateAdvanceCheckoutBody,
      getIdempotencyKey(req),
      getAuditContext(req, res),
    ),
  );
});

export const getMyPayment = catchAsync(async (req, res) => {
  const auth = requireOperationalAuth(req);
  const payment = await paymentService.getForCustomer(
    auth.userId,
    getValidatedParam(req, "paymentId"),
  );
  sendSuccess(res, payment);
});

export const listStaffPayments = catchAsync(async (req, res) => {
  const result = await paymentService.listForStaff(
    req.query as unknown as PaymentListQuery,
    getOperationalStaffScope(res),
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getStaffPayment = catchAsync(async (req, res) => {
  const payment = await paymentService.getForStaff(
    getValidatedParam(req, "paymentId"),
    getOperationalStaffScope(res),
  );
  sendSuccess(res, payment);
});

export const recordAdvance = catchAsync(async (req, res) => {
  const payment = await paymentService.recordAdvance(
    req.body as RecordAdvanceBody,
    getIdempotencyKey(req),
    getOperationalStaffScope(res),
    getAuditContext(req, res),
  );
  sendCreated(res, payment);
});

export const recordAdvanceRefund = catchAsync(async (req, res) => {
  const payment = await paymentService.recordRefund(
    getValidatedParam(req, "paymentId"),
    req.body as RecordRefundBody,
    getIdempotencyKey(req),
    getOperationalStaffScope(res),
    getAuditContext(req, res),
  );
  sendCreated(res, payment);
});

export const receivePaymentWebhook = catchAsync(async (req: Request, res) => {
  if (!req.rawBody) {
    throw ApiError.badRequest(
      "Exact webhook bytes were not captured",
      undefined,
      "WEBHOOK_RAW_BODY_REQUIRED",
    );
  }
  const event = await ingestPaymentWebhook({
    provider: getValidatedParam(req, "provider"),
    rawBody: req.rawBody,
    headers: req.headers,
  });
  res.status(202).json({
    success: true,
    data: {
      eventId: event._id,
      provider: event.provider,
      providerEventId: event.providerEventId,
      status: event.status,
    },
  });
});

export const listPaymentWebhookEvents = catchAsync(async (req, res) => {
  const result = await paymentWebhookOperationsService.list(
    req.query as unknown as WebhookEventListQuery,
  );
  sendPaginated(res, result.items, result.pagination);
});

export const retryPaymentWebhookEvent = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await paymentWebhookOperationsService.retry(
      getValidatedParam(req, "webhookEventId"),
      getAuditContext(req, res),
    ),
  );
});
