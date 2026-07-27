import { Router } from "express";

import authRouter from "./auth.routes.js";
import {
  customerBookingRouter,
  employeeSelfBookingRouter,
  staffBookingRouter,
} from "./booking.routes.js";
import {
  adminBusinessRouter,
  publicBusinessRouter,
} from "./business.routes.js";
import {
  adminCatalogRouter,
  publicCatalogRouter,
} from "./catalog.routes.js";
import { adminIntegrationRouter } from "./integration.routes.js";
import {
  adminNotificationRouter,
  selfNotificationRouter,
} from "./notification.routes.js";
import {
  adminAuditRouter,
  adminOutboxRouter,
} from "./operations.routes.js";
import {
  customerPaymentRouter,
  paymentWebhookRouter,
  staffPaymentRouter,
} from "./payment.routes.js";
import { paymentWebhookRateLimiter } from "../middlewares/rate-limit.middleware.js";
import peopleRouter from "./people.routes.js";
import {
  adminSchedulingRouter,
  employeeSchedulingRouter,
  publicSchedulingRouter,
} from "./scheduling.routes.js";

const router = Router();

router.use("/auth", authRouter);
router.use(
  "/webhooks/payments",
  paymentWebhookRateLimiter,
  paymentWebhookRouter,
);

router.use("/public/catalog", publicCatalogRouter);
router.use("/public", publicSchedulingRouter);
router.use("/public", publicBusinessRouter);

router.use("/customer/payments", customerPaymentRouter);
router.use("/customer", customerBookingRouter);
router.use("/staff/payments", staffPaymentRouter);
router.use("/staff", staffBookingRouter);
router.use("/notifications", selfNotificationRouter);

router.use("/admin/catalog", adminCatalogRouter);
router.use("/admin/scheduling", adminSchedulingRouter);
router.use("/admin/notifications", adminNotificationRouter);
router.use("/admin/integrations", adminIntegrationRouter);
router.use("/admin/audit-logs", adminAuditRouter);
router.use("/admin/outbox", adminOutboxRouter);
router.use("/admin", adminBusinessRouter);

router.use("/employees", employeeSelfBookingRouter);
router.use("/employees", employeeSchedulingRouter);
router.use(peopleRouter);

export default router;
