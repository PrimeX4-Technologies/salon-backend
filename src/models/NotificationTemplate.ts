import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "./shared.js";

export interface INotificationTemplate {
  salonId: Types.ObjectId;
  key: string;
  channel: "email" | "sms" | "whatsapp" | "push";
  locale: string;
  subject?: string;
  body: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationTemplateSchema = new Schema<INotificationTemplate>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
      match: /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    },
    channel: { type: String, enum: ["email", "sms", "whatsapp", "push"], required: true },
    locale: { type: String, default: "en", trim: true, maxlength: 20 },
    subject: { type: String, trim: true, maxlength: 300 },
    body: { type: String, required: true, maxlength: 20_000 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

NotificationTemplateSchema.index({ salonId: 1, key: 1, channel: 1, locale: 1 }, { unique: true });
NotificationTemplateSchema.index({ salonId: 1, channel: 1, isActive: 1 });

const NotificationTemplate = getOrCreateModel<INotificationTemplate>(
  "NotificationTemplate",
  NotificationTemplateSchema,
);

export { NotificationTemplateSchema };
export default NotificationTemplate;
