import {
  notificationPreferenceService,
  notificationQueueService,
  notificationTemplateService,
  pushSubscriptionService,
} from "../../services/notification.service.js";
import type {
  NotificationPreferenceBody,
  NotificationQueueListQuery,
  NotificationTemplateBody,
  NotificationTemplateListQuery,
  PushSubscriptionBody,
  UpdateNotificationTemplateBody,
} from "../../validation/notification.schemas.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from "../../utils/httpResponse.js";
import {
  getAuditContext,
  getValidatedParam,
} from "./request-audit-context.js";
import {
  getOperationalStaffScope,
  requireOperationalAuth,
} from "./operational-context.js";

export const getMyNotificationPreferences = catchAsync(async (req, res) => {
  const auth = requireOperationalAuth(req);
  sendSuccess(
    res,
    await notificationPreferenceService.getMine(auth.userId, auth.role),
  );
});

export const updateMyNotificationPreferences = catchAsync(
  async (req, res) => {
    const auth = requireOperationalAuth(req);
    sendSuccess(
      res,
      await notificationPreferenceService.upsertMine(
        auth.userId,
        auth.role,
        req.body as NotificationPreferenceBody,
        getAuditContext(req, res),
      ),
    );
  },
);

export const listMyPushSubscriptions = catchAsync(async (req, res) => {
  const auth = requireOperationalAuth(req);
  sendSuccess(res, await pushSubscriptionService.listMine(auth.userId));
});

export const registerMyPushSubscription = catchAsync(async (req, res) => {
  const auth = requireOperationalAuth(req);
  sendCreated(
    res,
    await pushSubscriptionService.registerMine(
      auth.userId,
      req.body as PushSubscriptionBody,
      getAuditContext(req, res),
    ),
  );
});

export const revokeMyPushSubscription = catchAsync(async (req, res) => {
  const auth = requireOperationalAuth(req);
  await pushSubscriptionService.revokeMine(
    auth.userId,
    getValidatedParam(req, "subscriptionId"),
    getAuditContext(req, res),
  );
  sendNoContent(res);
});

export const listNotificationTemplates = catchAsync(async (req, res) => {
  const result = await notificationTemplateService.list(
    req.query as unknown as NotificationTemplateListQuery,
  );
  sendPaginated(res, result.items as unknown[], result.pagination);
});

export const getNotificationTemplate = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await notificationTemplateService.get(
      getValidatedParam(req, "templateId"),
    ),
  );
});

export const createNotificationTemplate = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await notificationTemplateService.create(
      req.body as NotificationTemplateBody,
      getAuditContext(req, res),
    ),
  );
});

export const updateNotificationTemplate = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await notificationTemplateService.update(
      getValidatedParam(req, "templateId"),
      req.body as UpdateNotificationTemplateBody,
      getAuditContext(req, res),
    ),
  );
});

export const deactivateNotificationTemplate = catchAsync(
  async (req, res) => {
    sendSuccess(
      res,
      await notificationTemplateService.deactivate(
        getValidatedParam(req, "templateId"),
        getAuditContext(req, res),
      ),
    );
  },
);

export const listNotificationQueue = catchAsync(async (req, res) => {
  const result = await notificationQueueService.list(
    req.query as unknown as NotificationQueueListQuery,
    getOperationalStaffScope(res),
  );
  sendPaginated(res, result.items as unknown[], result.pagination);
});

export const retryNotification = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await notificationQueueService.retry(
      getValidatedParam(req, "notificationId"),
      getOperationalStaffScope(res),
      getAuditContext(req, res),
    ),
  );
});

export const cancelNotification = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await notificationQueueService.cancel(
      getValidatedParam(req, "notificationId"),
      getOperationalStaffScope(res),
      getAuditContext(req, res),
    ),
  );
});
