import { Schema, type Types } from "mongoose";

import { getOrCreateModel, isValidTimeZone } from "./shared.js";

interface INotificationChannels {
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  push: boolean;
}

interface INotificationTopics {
  bookingUpdates: boolean;
  reminders: boolean;
  waitlistUpdates: boolean;
  staffScheduleUpdates: boolean;
  marketing: boolean;
}

export interface INotificationPreference {
  salonId: Types.ObjectId;
  recipientType: "user" | "customer" | "employee";
  recipientId: Types.ObjectId;
  channels: INotificationChannels;
  topics: INotificationTopics;
  reminderLeadMinutes: number[];
  locale: string;
  timeZone: string;
  marketingConsentAt?: Date;
  marketingConsentWithdrawnAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationChannelsSchema = new Schema<INotificationChannels>(
  {
    email: { type: Boolean, default: true },
    sms: { type: Boolean, default: true },
    whatsapp: { type: Boolean, default: false },
    push: { type: Boolean, default: true },
  },
  { _id: false },
);

const NotificationTopicsSchema = new Schema<INotificationTopics>(
  {
    bookingUpdates: { type: Boolean, default: true },
    reminders: { type: Boolean, default: true },
    waitlistUpdates: { type: Boolean, default: true },
    staffScheduleUpdates: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false },
  },
  { _id: false },
);

const NotificationPreferenceSchema = new Schema<INotificationPreference>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    recipientType: { type: String, enum: ["user", "customer", "employee"], required: true },
    recipientId: { type: Schema.Types.ObjectId, required: true },
    channels: { type: NotificationChannelsSchema, default: () => ({}) },
    topics: { type: NotificationTopicsSchema, default: () => ({}) },
    reminderLeadMinutes: { type: [Number], default: [1440, 120] },
    locale: { type: String, default: "en", trim: true, maxlength: 20 },
    timeZone: {
      type: String,
      required: true,
      validate: { validator: isValidTimeZone, message: "Invalid IANA time zone" },
    },
    marketingConsentAt: Date,
    marketingConsentWithdrawnAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);

NotificationPreferenceSchema.index(
  { salonId: 1, recipientType: 1, recipientId: 1 },
  { unique: true },
);

NotificationPreferenceSchema.pre("validate", function () {
  if (!this.topics) {
    this.invalidate("topics", "Notification topics are required");
    return;
  }

  this.reminderLeadMinutes = [
    ...new Set(
      (this.reminderLeadMinutes ?? []).filter(
        (minutes) => Number.isInteger(minutes) && minutes > 0,
      ),
    ),
  ].sort((a, b) => b - a);

  if (this.topics.marketing && !this.marketingConsentAt) {
    this.invalidate("marketingConsentAt", "Marketing notifications require recorded consent");
  }

  if (this.topics.marketing && this.marketingConsentWithdrawnAt) {
    this.invalidate("topics.marketing", "Marketing must be disabled after consent is withdrawn");
  }

  if (
    this.marketingConsentWithdrawnAt &&
    this.marketingConsentAt &&
    this.marketingConsentWithdrawnAt < this.marketingConsentAt
  ) {
    this.invalidate("marketingConsentWithdrawnAt", "Consent withdrawal cannot predate consent");
  }
});

const NotificationPreference = getOrCreateModel<INotificationPreference>(
  "NotificationPreference",
  NotificationPreferenceSchema,
);

export { NotificationPreferenceSchema };
export default NotificationPreference;
