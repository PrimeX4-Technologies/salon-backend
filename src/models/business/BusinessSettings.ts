import { Schema, type Types } from "mongoose";

import { AdvancePolicySchema, type IAdvancePolicy } from "../core/pricing.js";
import { CURRENCY_PATTERN, getOrCreateModel } from "../core/shared.js";

interface IBookingSettings {
  slotIntervalMinutes: number;
  minimumNoticeMinutes: number;
  maximumAdvanceDays: number;
  temporaryHoldMinutes: number;
  cancellationWindowHours: number;
  allowWalkIns: boolean;
  allowWaitlist: boolean;
  allowProcessingOverlap: boolean;
}

interface ICustomerAuthSettings {
  emailPasswordEnabled: boolean;
  phonePasswordEnabled: boolean;
  googleEnabled: boolean;
}

interface IReminderSettings {
  enabled: boolean;
  leadMinutes: number[];
  channels: Array<"email" | "sms" | "whatsapp" | "push">;
}

export interface IBusinessSettings {
  singletonKey: "default";
  branchMode: "single" | "multiple";
  primaryBranchId: Types.ObjectId;
  locale: string;
  currency: string;
  finalPaymentHandling: "at_salon" | "external_system";
  booking: IBookingSettings;
  customerAuth: ICustomerAuthSettings;
  defaultAdvance: IAdvancePolicy;
  reminders: IReminderSettings;
  createdAt: Date;
  updatedAt: Date;
}

const BookingSettingsSchema = new Schema<IBookingSettings>(
  {
    slotIntervalMinutes: { type: Number, default: 15, min: 5, max: 120 },
    minimumNoticeMinutes: { type: Number, default: 60, min: 0, max: 525_600 },
    maximumAdvanceDays: { type: Number, default: 90, min: 1, max: 730 },
    temporaryHoldMinutes: { type: Number, default: 10, min: 1, max: 60 },
    cancellationWindowHours: { type: Number, default: 24, min: 0, max: 720 },
    allowWalkIns: { type: Boolean, default: true },
    allowWaitlist: { type: Boolean, default: true },
    allowProcessingOverlap: { type: Boolean, default: false },
  },
  { _id: false },
);

const CustomerAuthSettingsSchema = new Schema<ICustomerAuthSettings>(
  {
    emailPasswordEnabled: { type: Boolean, default: true },
    phonePasswordEnabled: { type: Boolean, default: true },
    googleEnabled: { type: Boolean, default: true },
  },
  { _id: false },
);

const ReminderSettingsSchema = new Schema<IReminderSettings>(
  {
    enabled: { type: Boolean, default: true },
    leadMinutes: { type: [Number], default: [1440, 120] },
    channels: {
      type: [{ type: String, enum: ["email", "sms", "whatsapp", "push"] }],
      default: ["email"],
    },
  },
  { _id: false },
);

const BusinessSettingsSchema = new Schema<IBusinessSettings>(
  {
    singletonKey: {
      type: String,
      enum: ["default"],
      default: "default",
      required: true,
      immutable: true,
    },
    branchMode: { type: String, enum: ["single", "multiple"], default: "single" },
    primaryBranchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    locale: { type: String, default: "en-LK", trim: true, maxlength: 20 },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      match: CURRENCY_PATTERN,
      default: "LKR",
    },
    finalPaymentHandling: {
      type: String,
      enum: ["at_salon", "external_system"],
      default: "external_system",
    },
    booking: { type: BookingSettingsSchema, default: () => ({}) },
    customerAuth: { type: CustomerAuthSettingsSchema, default: () => ({}) },
    defaultAdvance: { type: AdvancePolicySchema, default: () => ({}) },
    reminders: { type: ReminderSettingsSchema, default: () => ({}) },
  },
  { timestamps: true, optimisticConcurrency: true },
);

BusinessSettingsSchema.index({ singletonKey: 1 }, { unique: true });

BusinessSettingsSchema.pre("validate", function () {
  if (!this.defaultAdvance || !this.reminders) {
    if (!this.defaultAdvance) this.invalidate("defaultAdvance", "Default advance policy is required");
    if (!this.reminders) this.invalidate("reminders", "Reminder settings are required");
    return;
  }

  this.reminders.leadMinutes = [
    ...new Set(
      (this.reminders.leadMinutes ?? []).filter(
        (minutes) => Number.isInteger(minutes) && minutes > 0,
      ),
    ),
  ].sort((a, b) => b - a);
  this.reminders.channels = [...new Set(this.reminders.channels ?? [])];
});

const BusinessSettings = getOrCreateModel<IBusinessSettings>(
  "BusinessSettings",
  BusinessSettingsSchema,
);

export { BusinessSettingsSchema };
export default BusinessSettings;
