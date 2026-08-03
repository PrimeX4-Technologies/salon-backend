import { Router } from "express";

import {
  getMyPayment,
  getStaffPayment,
  createMyAdvanceCheckout,
  listPaymentWebhookEvents,
  listMyPayments,
  listStaffPayments,
  receivePaymentWebhook,
  recordAdvance,
  recordAdvanceRefund,
  retryPaymentWebhookEvent,
} from "../controllers/payment.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  authorizeRoles,
  requirePermissions,
} from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import { requireAllBranchAccess } from "../middlewares/business-access.middleware.js";
import {
  createAdvanceCheckoutBodySchema,
  customerPaymentListQuerySchema,
  paymentIdParamsSchema,
  paymentListQuerySchema,
  paymentWebhookParamsSchema,
  recordAdvanceBodySchema,
  recordRefundBodySchema,
  webhookEventIdParamsSchema,
  webhookEventListQuerySchema,
} from "../../validation/payment.schemas.js";

export const customerPaymentRouter = Router();
customerPaymentRouter.use(authenticate, authorizeRoles("customer"));
customerPaymentRouter.get(
  "/",
  validate({ query: customerPaymentListQuerySchema }),
  listMyPayments,
);
customerPaymentRouter.post(
  "/advance-checkouts",
  validate({ body: createAdvanceCheckoutBodySchema }),
  createMyAdvanceCheckout,
);
customerPaymentRouter.get(
  "/:paymentId",
  validate({ params: paymentIdParamsSchema }),
  getMyPayment,
);

export const staffPaymentRouter = Router();
staffPaymentRouter.use(authenticate, authorizeRoles("admin", "employee"));
staffPaymentRouter.get(
  "/",
  requirePermissions("view_booking_payments"),
  validate({ query: paymentListQuerySchema }),
  listStaffPayments,
);
staffPaymentRouter.get(
  "/webhook-events",
  authorizeRoles("admin"),
  requirePermissions("view_booking_payments", "manage_integrations"),
  requireAllBranchAccess,
  validate({ query: webhookEventListQuerySchema }),
  listPaymentWebhookEvents,
);
staffPaymentRouter.post(
  "/webhook-events/:webhookEventId/retry",
  authorizeRoles("admin"),
  requirePermissions("view_booking_payments", "manage_integrations"),
  requireAllBranchAccess,
  validate({ params: webhookEventIdParamsSchema }),
  retryPaymentWebhookEvent,
);
staffPaymentRouter.post(
  "/advances",
  requirePermissions("view_booking_payments", "manage_bookings"),
  validate({ body: recordAdvanceBodySchema }),
  recordAdvance,
);
staffPaymentRouter.post(
  "/:paymentId/refunds",
  requirePermissions("view_booking_payments", "manage_bookings"),
  validate({
    params: paymentIdParamsSchema,
    body: recordRefundBodySchema,
  }),
  recordAdvanceRefund,
);
staffPaymentRouter.get(
  "/:paymentId",
  requirePermissions("view_booking_payments"),
  validate({ params: paymentIdParamsSchema }),
  getStaffPayment,
);

export const paymentWebhookRouter = Router();
paymentWebhookRouter.post(
  "/:provider",
  validate({ params: paymentWebhookParamsSchema }),
  receivePaymentWebhook,
);
