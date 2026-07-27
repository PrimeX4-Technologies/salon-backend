import { z } from "zod";

import {
  instantSchema,
  objectIdSchema,
  paginationQuerySchema,
} from "./common.schemas.js";

const channelSchema = z.enum(["email", "sms", "whatsapp", "push"]);
const topicSchema = z.enum([
  "booking_update",
  "reminder",
  "waitlist_update",
  "staff_schedule",
  "marketing",
  "system",
]);
const localeSchema = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/);
const templateKeySchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

export const notificationPreferenceBodySchema = z
  .object({
    channels: z
      .object({
        email: z.boolean().optional(),
        sms: z.boolean().optional(),
        whatsapp: z.boolean().optional(),
        push: z.boolean().optional(),
      })
      .strict()
      .optional(),
    topics: z
      .object({
        bookingUpdates: z.boolean().optional(),
        reminders: z.boolean().optional(),
        waitlistUpdates: z.boolean().optional(),
        staffScheduleUpdates: z.boolean().optional(),
        marketing: z.boolean().optional(),
      })
      .strict()
      .optional(),
    reminderLeadMinutes: z
      .array(z.number().int().positive().max(525_600))
      .max(20)
      .optional(),
    locale: localeSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one preference field is required",
  });

export const pushSubscriptionBodySchema = z
  .object({
    provider: z.enum(["fcm", "apns", "web_push"]),
    platform: z.enum(["web", "ios", "android"]),
    deviceId: z.string().trim().min(1).max(255),
    token: z.string().trim().min(16).max(8192),
  })
  .strict();

export const pushSubscriptionParamsSchema = z
  .object({ subscriptionId: objectIdSchema })
  .strict();

export const templateIdParamsSchema = z
  .object({ templateId: objectIdSchema })
  .strict();

export const notificationIdParamsSchema = z
  .object({ notificationId: objectIdSchema })
  .strict();

const notificationTemplateObjectSchema = z
  .object({
    key: templateKeySchema,
    channel: channelSchema,
    locale: localeSchema.default("en"),
    subject: z.string().trim().max(300).optional().nullable(),
    body: z.string().min(1).max(20_000),
    isActive: z.boolean().optional().default(true),
  })
  .strict();

export const notificationTemplateBodySchema =
  notificationTemplateObjectSchema.superRefine((value, context) => {
    if (value.channel === "email" && !value.subject) {
      context.addIssue({
        code: "custom",
        path: ["subject"],
        message: "Email templates require a subject",
      });
    }
  });

export const updateNotificationTemplateBodySchema =
  notificationTemplateObjectSchema
    .partial()
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one template field is required",
    });

export const notificationTemplateListQuerySchema = paginationQuerySchema
  .extend({
    channel: channelSchema.optional(),
    isActive: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    locale: localeSchema.optional(),
  })
  .strict();

export const notificationQueueListQuerySchema = paginationQuerySchema
  .extend({
    status: z
      .enum(["queued", "processing", "sent", "failed", "cancelled"])
      .optional(),
    channel: channelSchema.optional(),
    topic: topicSchema.optional(),
    bookingId: objectIdSchema.optional(),
    scheduledFrom: instantSchema.optional(),
    scheduledTo: instantSchema.optional(),
  })
  .strict();

export type NotificationPreferenceBody = z.infer<
  typeof notificationPreferenceBodySchema
>;
export type PushSubscriptionBody = z.infer<
  typeof pushSubscriptionBodySchema
>;
export type NotificationTemplateBody = z.infer<
  typeof notificationTemplateBodySchema
>;
export type UpdateNotificationTemplateBody = z.infer<
  typeof updateNotificationTemplateBodySchema
>;
export type NotificationTemplateListQuery = z.infer<
  typeof notificationTemplateListQuerySchema
>;
export type NotificationQueueListQuery = z.infer<
  typeof notificationQueueListQuerySchema
>;
