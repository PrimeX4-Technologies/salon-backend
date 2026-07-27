import { Types, type QueryFilter } from "mongoose";

import Notification, {
  type INotification,
} from "../models/notifications/Notification.js";
import NotificationPreference from "../models/notifications/NotificationPreference.js";
import NotificationTemplate, {
  type INotificationTemplate,
} from "../models/notifications/NotificationTemplate.js";
import PushSubscription from "../models/notifications/PushSubscription.js";
import {
  getNotificationProvider,
  listConfiguredNotificationChannels,
  type NotificationChannel,
} from "../ports/notification-provider.js";
import { notificationRepository } from "../repositories/notification.repository.js";
import type { UserRole } from "../models/auth/User.js";
import type {
  NotificationPreferenceBody,
  NotificationQueueListQuery,
  NotificationTemplateBody,
  NotificationTemplateListQuery,
  PushSubscriptionBody,
  UpdateNotificationTemplateBody,
} from "../validation/notification.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import {
  encryptSensitiveText,
  hashSensitiveValue,
} from "../utils/fieldEncryption.js";
import { buildPaginationMeta } from "../utils/pagination.js";
import {
  isWorkerLeaseLostError,
  runWithLeaseHeartbeat,
} from "../utils/workerLease.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";
import {
  assertOperationalBranchAccess,
  type StaffBranchScope,
} from "./operational-access.js";

type RecipientType = "user" | "customer" | "employee";

interface RecipientOwnership {
  recipientType: RecipientType;
  recipientId: Types.ObjectId;
}

export interface EnqueueNotificationInput {
  recipientType: RecipientType;
  recipientId: Types.ObjectId | string;
  bookingId?: Types.ObjectId | string;
  channel: NotificationChannel;
  topic: INotification["topic"];
  destination: string;
  templateKey: string;
  locale?: string;
  variables?: Record<string, string>;
  idempotencyKey: string;
  scheduledAt?: Date;
  maxAttempts?: number;
}

const topicPreferenceField: Record<
  Exclude<INotification["topic"], "system">,
  "bookingUpdates" | "reminders" | "waitlistUpdates" | "staffScheduleUpdates" | "marketing"
> = {
  booking_update: "bookingUpdates",
  reminder: "reminders",
  waitlist_update: "waitlistUpdates",
  staff_schedule: "staffScheduleUpdates",
  marketing: "marketing",
};

const toObjectId = (value: Types.ObjectId | string): Types.ObjectId =>
  typeof value === "string" ? new Types.ObjectId(value) : value;

const isDuplicateKey = (error: unknown): boolean =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000,
  );

const getOwnedRecipient = async (
  userId: string,
  role: UserRole,
): Promise<RecipientOwnership> => {
  const id = new Types.ObjectId(userId);
  if (role === "customer") {
    const customer = await notificationRepository.findCustomerRecipient(id);
    if (!customer) {
      throw ApiError.notFound(
        "Customer profile was not found",
        "CUSTOMER_PROFILE_NOT_FOUND",
      );
    }
    return { recipientType: "customer", recipientId: customer._id };
  }
  if (role === "employee") {
    const employee = await notificationRepository.findEmployeeRecipient(id);
    if (!employee) {
      throw ApiError.notFound(
        "Employee profile was not found",
        "EMPLOYEE_PROFILE_NOT_FOUND",
      );
    }
    return { recipientType: "employee", recipientId: employee._id };
  }
  return { recipientType: "user", recipientId: id };
};

const ensurePreference = async (
  ownership: RecipientOwnership,
) => {
  const found = await notificationRepository.findPreference(
    ownership.recipientType,
    ownership.recipientId,
  );
  if (found) return found;
  try {
    return await NotificationPreference.create(ownership);
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const raced = await notificationRepository.findPreference(
      ownership.recipientType,
      ownership.recipientId,
    );
    if (!raced) throw error;
    return raced;
  }
};

const assertNotificationBranchScope = async (
  notification: Pick<INotification, "bookingId">,
  scope: StaffBranchScope,
): Promise<void> => {
  if (scope.allBranches) return;
  if (!notification.bookingId) {
    throw ApiError.forbidden(
      "Global notifications require access to every branch",
      "ALL_BRANCH_ACCESS_REQUIRED",
    );
  }
  const booking = await notificationRepository.findBookingBranch(
    notification.bookingId,
  );
  if (!booking) {
    throw ApiError.notFound("Related booking was not found", "BOOKING_NOT_FOUND");
  }
  assertOperationalBranchAccess(scope, booking.branchId);
};

export const notificationPreferenceService = {
  async getMine(userId: string, role: UserRole) {
    return ensurePreference(await getOwnedRecipient(userId, role));
  },

  async upsertMine(
    userId: string,
    role: UserRole,
    input: NotificationPreferenceBody,
    context: AuditActorContext,
  ) {
    const ownership = await getOwnedRecipient(userId, role);
    const preference = await ensurePreference(ownership);
    if (input.channels) {
      Object.assign(preference.channels, input.channels);
    }
    if (input.topics) {
      const previouslyMarketing = preference.topics.marketing;
      Object.assign(preference.topics, input.topics);
      const nextMarketing = preference.topics.marketing;
      if (!previouslyMarketing && nextMarketing) {
        preference.marketingConsentAt = new Date();
        preference.marketingConsentWithdrawnAt = undefined;
      } else if (previouslyMarketing && !nextMarketing) {
        preference.marketingConsentWithdrawnAt = new Date();
      }
    }
    if (input.reminderLeadMinutes) {
      preference.reminderLeadMinutes = input.reminderLeadMinutes;
    }
    if (input.locale) preference.locale = input.locale;
    await preference.save();
    await recordAudit({
      context,
      action: "notification_preference.updated",
      entityType: "NotificationPreference",
      entityId: preference._id,
      changes: { fields: Object.keys(input) },
    });
    return preference;
  },
};

export const pushSubscriptionService = {
  listMine(userId: string) {
    return notificationRepository.listSubscriptions(new Types.ObjectId(userId));
  },

  async registerMine(
    userId: string,
    input: PushSubscriptionBody,
    context: AuditActorContext,
  ) {
    const ownerId = new Types.ObjectId(userId);
    const tokenHash = hashSensitiveValue(input.token, "push-subscription");
    const encryptedToken = encryptSensitiveText(
      input.token,
      `push-subscription:${ownerId.toString()}`,
    );
    const sameToken =
      await notificationRepository.findSubscriptionWithSecrets({ tokenHash });
    if (sameToken && !sameToken.userId.equals(ownerId)) {
      throw ApiError.conflict(
        "This push token is already assigned to another account",
        undefined,
        "PUSH_TOKEN_OWNERSHIP_CONFLICT",
      );
    }
    const subscription =
      sameToken ??
      (await notificationRepository.findSubscriptionWithSecrets({
        userId: ownerId,
        provider: input.provider,
        deviceId: input.deviceId,
      })) ??
      new PushSubscription({
        userId: ownerId,
        provider: input.provider,
        deviceId: input.deviceId,
      });
    subscription.platform = input.platform;
    subscription.encryptedToken = encryptedToken;
    subscription.tokenHash = tokenHash;
    subscription.status = "active";
    subscription.invalidatedAt = undefined;
    subscription.lastSeenAt = new Date();
    await subscription.save();
    await recordAudit({
      context,
      action: "push_subscription.registered",
      entityType: "PushSubscription",
      entityId: subscription._id,
      changes: { provider: input.provider, platform: input.platform },
    });
    return notificationRepository.findSubscription(subscription._id);
  },

  async revokeMine(
    userId: string,
    subscriptionId: string,
    context: AuditActorContext,
  ): Promise<void> {
    const subscription = await notificationRepository.findSubscription(
      new Types.ObjectId(subscriptionId),
    );
    if (!subscription || !subscription.userId.equals(userId)) {
      throw ApiError.notFound(
        "Push subscription was not found",
        "PUSH_SUBSCRIPTION_NOT_FOUND",
      );
    }
    if (subscription.status !== "revoked") {
      subscription.status = "revoked";
      subscription.invalidatedAt = new Date();
      await subscription.save();
      await recordAudit({
        context,
        action: "push_subscription.revoked",
        entityType: "PushSubscription",
        entityId: subscription._id,
      });
    }
  },
};

export const notificationTemplateService = {
  async list(query: NotificationTemplateListQuery) {
    const filter: QueryFilter<INotificationTemplate> = {};
    if (query.channel) filter.channel = query.channel;
    if (query.locale) filter.locale = query.locale;
    if (query.isActive !== undefined) filter.isActive = query.isActive;
    if (query.search) {
      const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$or = [
        { key: new RegExp(escaped, "i") },
        { subject: new RegExp(escaped, "i") },
      ];
    }
    const [items, total] = await Promise.all([
      NotificationTemplate.find(filter)
        .select("-__v")
        .sort({ key: 1, channel: 1, locale: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      NotificationTemplate.countDocuments(filter),
    ]);
    return { items, pagination: buildPaginationMeta(total, query) };
  },

  async get(templateId: string) {
    const template = await notificationRepository.findTemplate(
      new Types.ObjectId(templateId),
    );
    if (!template) {
      throw ApiError.notFound(
        "Notification template was not found",
        "NOTIFICATION_TEMPLATE_NOT_FOUND",
      );
    }
    return template;
  },

  async create(input: NotificationTemplateBody, context: AuditActorContext) {
    const template = await NotificationTemplate.create({
      ...input,
      subject: input.subject ?? undefined,
    });
    await recordAudit({
      context,
      action: "notification_template.created",
      entityType: "NotificationTemplate",
      entityId: template._id,
      changes: { key: template.key, channel: template.channel, locale: template.locale },
    });
    return template;
  },

  async update(
    templateId: string,
    input: UpdateNotificationTemplateBody,
    context: AuditActorContext,
  ) {
    const template = await notificationRepository.findTemplate(
      new Types.ObjectId(templateId),
    );
    if (!template) {
      throw ApiError.notFound(
        "Notification template was not found",
        "NOTIFICATION_TEMPLATE_NOT_FOUND",
      );
    }
    template.set({
      ...input,
      ...(input.subject !== undefined
        ? { subject: input.subject ?? undefined }
        : {}),
    });
    if (template.channel === "email" && !template.subject) {
      throw ApiError.badRequest(
        "Email templates require a subject",
        undefined,
        "EMAIL_SUBJECT_REQUIRED",
      );
    }
    await template.save();
    await recordAudit({
      context,
      action: "notification_template.updated",
      entityType: "NotificationTemplate",
      entityId: template._id,
      changes: { fields: Object.keys(input) },
    });
    return template;
  },

  async deactivate(templateId: string, context: AuditActorContext) {
    const template = await notificationRepository.findTemplate(
      new Types.ObjectId(templateId),
    );
    if (!template) {
      throw ApiError.notFound(
        "Notification template was not found",
        "NOTIFICATION_TEMPLATE_NOT_FOUND",
      );
    }
    if (template.isActive) {
      template.isActive = false;
      await template.save();
      await recordAudit({
        context,
        action: "notification_template.deactivated",
        entityType: "NotificationTemplate",
        entityId: template._id,
      });
    }
    return template;
  },
};

export const enqueueNotification = async (
  input: EnqueueNotificationInput,
): Promise<{ notification: INotification; created: boolean }> => {
  const recipientId = toObjectId(input.recipientId);
  const locale = input.locale ?? "en";
  const template = await notificationRepository.findActiveTemplate(
    input.templateKey,
    input.channel,
    locale,
  );
  if (!template) {
    throw ApiError.conflict(
      "An active notification template is not configured",
      undefined,
      "NOTIFICATION_TEMPLATE_UNAVAILABLE",
    );
  }
  if (input.topic !== "system") {
    const preference = await notificationRepository.findPreference(
      input.recipientType,
      recipientId,
    );
    if (!preference) {
      if (input.topic === "marketing" || input.channel === "whatsapp") {
        throw ApiError.conflict(
          "The recipient has not consented to this notification",
          undefined,
          "NOTIFICATION_NOT_CONSENTED",
        );
      }
    } else {
      const topicField = topicPreferenceField[input.topic];
      if (
        !preference.channels[input.channel] ||
        !preference.topics[topicField]
      ) {
        throw ApiError.conflict(
          "The recipient has disabled this notification",
          undefined,
          "NOTIFICATION_NOT_CONSENTED",
        );
      }
    }
  }
  try {
    const notification = await Notification.create({
      recipientType: input.recipientType,
      recipientId,
      bookingId: input.bookingId ? toObjectId(input.bookingId) : undefined,
      channel: input.channel,
      topic: input.topic,
      destination: input.destination,
      templateKey: input.templateKey,
      locale,
      variables: input.variables ?? {},
      idempotencyKey: input.idempotencyKey,
      status: "queued",
      scheduledAt: input.scheduledAt ?? new Date(),
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 5,
    });
    return { notification, created: true };
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await Notification.findOne({
      idempotencyKey: input.idempotencyKey,
    }).select("+idempotencyKey");
    if (!existing) throw error;
    if (
      existing.recipientType !== input.recipientType ||
      !existing.recipientId.equals(recipientId) ||
      existing.channel !== input.channel ||
      existing.topic !== input.topic ||
      existing.templateKey !== input.templateKey ||
      (existing.bookingId?.toString() ?? undefined) !==
        (input.bookingId?.toString() ?? undefined)
    ) {
      throw ApiError.conflict(
        "The idempotency key was already used for a different notification",
        undefined,
        "IDEMPOTENCY_KEY_REUSED",
      );
    }
    return { notification: existing, created: false };
  }
};

export const notificationQueueService = {
  async list(query: NotificationQueueListQuery, scope: StaffBranchScope) {
    const filter: QueryFilter<INotification> = {};
    if (query.status) filter.status = query.status;
    if (query.channel) filter.channel = query.channel;
    if (query.topic) filter.topic = query.topic;
    if (query.bookingId) filter.bookingId = new Types.ObjectId(query.bookingId);
    if (query.scheduledFrom || query.scheduledTo) {
      filter.scheduledAt = {
        ...(query.scheduledFrom ? { $gte: query.scheduledFrom } : {}),
        ...(query.scheduledTo ? { $lt: query.scheduledTo } : {}),
      };
    }
    const skip = (query.page - 1) * query.limit;
    const result = scope.allBranches
      ? await notificationRepository.listNotifications(filter, skip, query.limit)
      : await notificationRepository.listNotificationsForBranches(
          filter,
          scope.branchIds,
          skip,
          query.limit,
        );
    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, query),
    };
  },

  async retry(
    notificationId: string,
    scope: StaffBranchScope,
    context: AuditActorContext,
  ) {
    const notification = await notificationRepository.findNotification(
      new Types.ObjectId(notificationId),
    );
    if (!notification) {
      throw ApiError.notFound("Notification was not found", "NOTIFICATION_NOT_FOUND");
    }
    await assertNotificationBranchScope(notification, scope);
    if (notification.status !== "failed") {
      throw ApiError.conflict(
        "Only failed notifications can be retried",
        undefined,
        "NOTIFICATION_NOT_RETRYABLE",
      );
    }
    notification.status = "queued";
    notification.nextAttemptAt = new Date();
    notification.attempts = 0;
    notification.lastError = undefined;
    await notification.save();
    await recordAudit({
      context,
      action: "notification.retried",
      entityType: "Notification",
      entityId: notification._id,
    });
    return notification;
  },

  async cancel(
    notificationId: string,
    scope: StaffBranchScope,
    context: AuditActorContext,
  ) {
    const notification = await notificationRepository.findNotification(
      new Types.ObjectId(notificationId),
    );
    if (!notification) {
      throw ApiError.notFound("Notification was not found", "NOTIFICATION_NOT_FOUND");
    }
    await assertNotificationBranchScope(notification, scope);
    if (!["queued", "failed"].includes(notification.status)) {
      throw ApiError.conflict(
        "A processing or delivered notification cannot be cancelled",
        undefined,
        "NOTIFICATION_NOT_CANCELLABLE",
      );
    }
    notification.status = "cancelled";
    notification.nextAttemptAt = undefined;
    await notification.save();
    await recordAudit({
      context,
      action: "notification.cancelled",
      entityType: "Notification",
      entityId: notification._id,
    });
    return notification;
  },
};

const render = (
  source: string,
  variables: Map<string, string>,
): string =>
  source.replace(
    /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g,
    (match, key: string) => variables.get(key) ?? match,
  );

export const claimAndDeliverNextNotification = async (
  workerId: string,
  options: { leaseMs?: number } = {},
): Promise<
  "idle" | "sent" | "retry_scheduled" | "failed" | "lease_lost"
> => {
  const configuredChannels = listConfiguredNotificationChannels();
  if (configuredChannels.length === 0) return "idle";
  const now = new Date();
  const workerName = workerId.slice(0, 200);
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const notification = await Notification.findOneAndUpdate(
    {
      $expr: { $lt: ["$attempts", "$maxAttempts"] },
      channel: { $in: configuredChannels },
      $or: [
        {
          status: "queued",
          scheduledAt: { $lte: now },
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
    { new: true, sort: { scheduledAt: 1, _id: 1 } },
  ).select("+destination +variables +lastError");
  if (!notification) return "idle";

  try {
    const template = await notificationRepository.findActiveTemplate(
      notification.templateKey,
      notification.channel,
      notification.locale,
    );
    if (!template) throw new Error("Active notification template is unavailable");
    const provider = getNotificationProvider(notification.channel);
    const result = await runWithLeaseHeartbeat(
      () =>
        provider.send({
          notificationId: notification._id.toString(),
          channel: notification.channel,
          destination: notification.destination,
          subject: template.subject
            ? render(template.subject, notification.variables)
            : undefined,
          body: render(template.body, notification.variables),
          locale: notification.locale,
        }),
      () =>
        extendNotificationWorkerLease(
          notification._id,
          workerName,
          leaseMs,
        ),
      leaseMs,
    );
    const completed = await Notification.updateOne(
      {
        _id: notification._id,
        status: "processing",
        lockedBy: workerName,
      },
      {
        $set: {
          status: "sent",
          providerMessageId: result.providerMessageId,
          sentAt: result.acceptedAt,
        },
        $unset: {
          nextAttemptAt: 1,
          lastError: 1,
          lockedAt: 1,
          lockedBy: 1,
          lockExpiresAt: 1,
        },
      },
    );
    if (completed.modifiedCount !== 1) return "lease_lost";
    return "sent";
  } catch (error) {
    if (isWorkerLeaseLostError(error)) return "lease_lost";
    const lastError =
      error instanceof Error ? error.message.slice(0, 2000) : "Unknown error";
    const terminal = notification.attempts >= notification.maxAttempts;
    const delaySeconds = Math.min(
      3600,
      2 ** Math.min(notification.attempts, 10) * 5,
    );
    const failed = await Notification.updateOne(
      {
        _id: notification._id,
        status: "processing",
        lockedBy: workerName,
      },
      {
        $set: {
          status: terminal ? "failed" : "queued",
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

export const extendNotificationWorkerLease = async (
  notificationId: Types.ObjectId | string,
  workerId: string,
  leaseMs = 5 * 60_000,
): Promise<boolean> => {
  const now = new Date();
  const result = await Notification.updateOne(
    {
      _id: notificationId,
      status: "processing",
      lockedBy: workerId.slice(0, 200),
      lockExpiresAt: { $gt: now },
    },
    { $set: { lockExpiresAt: new Date(now.getTime() + leaseMs) } },
  );
  return result.modifiedCount === 1;
};
