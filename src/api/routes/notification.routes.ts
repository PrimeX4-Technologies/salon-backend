import { Router } from "express";

import {
  cancelNotification,
  createNotificationTemplate,
  deactivateNotificationTemplate,
  getMyNotificationPreferences,
  getNotificationTemplate,
  listMyPushSubscriptions,
  listNotificationQueue,
  listNotificationTemplates,
  registerMyPushSubscription,
  retryNotification,
  revokeMyPushSubscription,
  updateMyNotificationPreferences,
  updateNotificationTemplate,
} from "../controllers/notification.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { requireAllBranchAccess } from "../middlewares/business-access.middleware.js";
import {
  authorizeRoles,
  requirePermissions,
} from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  notificationIdParamsSchema,
  notificationPreferenceBodySchema,
  notificationQueueListQuerySchema,
  notificationTemplateBodySchema,
  notificationTemplateListQuerySchema,
  pushSubscriptionBodySchema,
  pushSubscriptionParamsSchema,
  templateIdParamsSchema,
  updateNotificationTemplateBodySchema,
} from "../../validation/notification.schemas.js";

export const selfNotificationRouter = Router();
selfNotificationRouter.use(authenticate);
selfNotificationRouter.get("/preferences", getMyNotificationPreferences);
selfNotificationRouter.put(
  "/preferences",
  validate({ body: notificationPreferenceBodySchema }),
  updateMyNotificationPreferences,
);
selfNotificationRouter.get(
  "/push-subscriptions",
  listMyPushSubscriptions,
);
selfNotificationRouter.post(
  "/push-subscriptions",
  validate({ body: pushSubscriptionBodySchema }),
  registerMyPushSubscription,
);
selfNotificationRouter.delete(
  "/push-subscriptions/:subscriptionId",
  validate({ params: pushSubscriptionParamsSchema }),
  revokeMyPushSubscription,
);

export const adminNotificationRouter = Router();
adminNotificationRouter.use(
  authenticate,
  authorizeRoles("admin", "employee"),
  requirePermissions("manage_notifications"),
);
adminNotificationRouter.get(
  "/queue",
  validate({ query: notificationQueueListQuerySchema }),
  listNotificationQueue,
);
adminNotificationRouter.post(
  "/queue/:notificationId/retry",
  validate({ params: notificationIdParamsSchema }),
  retryNotification,
);
adminNotificationRouter.post(
  "/queue/:notificationId/cancel",
  validate({ params: notificationIdParamsSchema }),
  cancelNotification,
);
adminNotificationRouter.get(
  "/templates",
  requireAllBranchAccess,
  validate({ query: notificationTemplateListQuerySchema }),
  listNotificationTemplates,
);
adminNotificationRouter.post(
  "/templates",
  requireAllBranchAccess,
  validate({ body: notificationTemplateBodySchema }),
  createNotificationTemplate,
);
adminNotificationRouter.get(
  "/templates/:templateId",
  requireAllBranchAccess,
  validate({ params: templateIdParamsSchema }),
  getNotificationTemplate,
);
adminNotificationRouter.patch(
  "/templates/:templateId",
  requireAllBranchAccess,
  validate({
    params: templateIdParamsSchema,
    body: updateNotificationTemplateBodySchema,
  }),
  updateNotificationTemplate,
);
adminNotificationRouter.delete(
  "/templates/:templateId",
  requireAllBranchAccess,
  validate({ params: templateIdParamsSchema }),
  deactivateNotificationTemplate,
);
