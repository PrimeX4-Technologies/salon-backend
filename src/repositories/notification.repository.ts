import type { QueryFilter, Types } from "mongoose";

import Booking from "../models/bookings/Booking.js";
import Customer from "../models/customers/Customer.js";
import Employee from "../models/staff/Employee.js";
import Notification, {
  type INotification,
} from "../models/notifications/Notification.js";
import NotificationPreference from "../models/notifications/NotificationPreference.js";
import NotificationTemplate from "../models/notifications/NotificationTemplate.js";
import PushSubscription from "../models/notifications/PushSubscription.js";

export const NOTIFICATION_SAFE_SELECT =
  "recipientType recipientId bookingId channel topic templateKey locale status scheduledAt nextAttemptAt attempts maxAttempts lockedAt lockExpiresAt sentAt createdAt updatedAt";

export const notificationRepository = {
  findCustomerRecipient: (userId: Types.ObjectId) =>
    Customer.findOne({ userId }).select("_id status").lean(),
  findEmployeeRecipient: (userId: Types.ObjectId) =>
    Employee.findOne({ userId }).select("_id status").lean(),
  findPreference: (
    recipientType: "user" | "customer" | "employee",
    recipientId: Types.ObjectId,
  ) => NotificationPreference.findOne({ recipientType, recipientId }),
  listSubscriptions: (userId: Types.ObjectId) =>
    PushSubscription.find({ userId })
      .select("provider platform deviceId status lastSeenAt invalidatedAt createdAt updatedAt")
      .sort({ updatedAt: -1 })
      .lean(),
  findSubscription: (subscriptionId: Types.ObjectId) =>
    PushSubscription.findById(subscriptionId),
  findSubscriptionWithSecrets: (filter: Record<string, unknown>) =>
    PushSubscription.findOne(filter).select("+tokenHash +encryptedToken"),
  findTemplate: (templateId: Types.ObjectId) =>
    NotificationTemplate.findById(templateId),
  findActiveTemplate: (
    key: string,
    channel: INotification["channel"],
    locale: string,
  ) =>
    NotificationTemplate.findOne({
      key,
      channel,
      locale,
      isActive: true,
    }),
  listNotifications: async (
    filter: QueryFilter<INotification>,
    skip: number,
    limit: number,
  ) => {
    const [items, total] = await Promise.all([
      Notification.find(filter)
        .select(NOTIFICATION_SAFE_SELECT)
        .sort({ scheduledAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(filter),
    ]);
    return { items, total };
  },
  listNotificationsForBranches: async (
    filter: QueryFilter<INotification>,
    branchIds: Types.ObjectId[],
    skip: number,
    limit: number,
  ) => {
    const [result] = await Notification.aggregate<{
      items: Array<Record<string, unknown>>;
      total: Array<{ value: number }>;
    }>([
      { $match: { $and: [filter, { bookingId: { $type: "objectId" } }] } },
      {
        $lookup: {
          from: "bookings",
          localField: "bookingId",
          foreignField: "_id",
          as: "_booking",
        },
      },
      { $match: { "_booking.branchId": { $in: branchIds } } },
      { $sort: { scheduledAt: -1, _id: -1 } },
      {
        $facet: {
          items: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                recipientType: 1,
                recipientId: 1,
                bookingId: 1,
                channel: 1,
                topic: 1,
                templateKey: 1,
                locale: 1,
                status: 1,
                scheduledAt: 1,
                nextAttemptAt: 1,
                attempts: 1,
                maxAttempts: 1,
                lockedAt: 1,
                lockExpiresAt: 1,
                sentAt: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],
          total: [{ $count: "value" }],
        },
      },
    ]);
    return {
      items: result?.items ?? [],
      total: result?.total[0]?.value ?? 0,
    };
  },
  findNotification: (notificationId: Types.ObjectId) =>
    Notification.findById(notificationId),
  findNotificationForDelivery: (notificationId: Types.ObjectId) =>
    Notification.findById(notificationId).select(
      "+destination +variables +providerMessageId +lastError",
    ),
  findBookingBranch: (bookingId: Types.ObjectId) =>
    Booking.findById(bookingId).select("branchId").lean(),
};
