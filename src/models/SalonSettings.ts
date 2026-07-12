import { Schema, type Types } from "mongoose";

import { CURRENCY_PATTERN, getOrCreateModel, isNonNegativeInteger } from "./shared.js";

interface IDefaultDepositPolicy {
  type: "none" | "fixed" | "percentage";
  fixedAmountMinor?: number;
  percentage?: number;
}

interface IBookingSettings {
  slotIntervalMinutes: number;
  minimumNoticeMinutes: number;
  maximumAdvanceDays: number;
  temporaryHoldMinutes: number;
  cancellationWindowHours: number;
  lateCancellationChargePercentage: number;
  noShowChargePercentage: number;
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

export interface ISalonSettings {
  salonId: Types.ObjectId;
  locale: string;
  currency: string;
  booking: IBookingSettings;
  customerAuth: ICustomerAuthSettings;
  defaultDeposit: IDefaultDepositPolicy;
  reminders: IReminderSettings;
  createdAt: Date;
  updatedAt: Date;
}

const DefaultDepositPolicySchema = new Schema<IDefaultDepositPolicy>(
  {
    type: { type: String, enum: ["none", "fixed", "percentage"], default: "none" },
    fixedAmountMinor: {
      type: Number,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must be integer minor units" },
    },
    percentage: { type: Number, min: 0, max: 100 },
  },
  { _id: false },
);

const BookingSettingsSchema = new Schema<IBookingSettings>(
  {
    slotIntervalMinutes: { type: Number, default: 15, min: 5, max: 120 },
    minimumNoticeMinutes: { type: Number, default: 60, min: 0, max: 525_600 },
    maximumAdvanceDays: { type: Number, default: 90, min: 1, max: 730 },
    temporaryHoldMinutes: { type: Number, default: 10, min: 1, max: 60 },
    cancellationWindowHours: { type: Number, default: 24, min: 0, max: 720 },
    lateCancellationChargePercentage: { type: Number, default: 0, min: 0, max: 100 },
    noShowChargePercentage: { type: Number, default: 0, min: 0, max: 100 },
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

const SalonSettingsSchema = new Schema<ISalonSettings>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    locale: { type: String, default: "en", trim: true, maxlength: 20 },
    currency: { type: String, required: true, uppercase: true, match: CURRENCY_PATTERN },
    booking: { type: BookingSettingsSchema, default: () => ({}) },
    customerAuth: { type: CustomerAuthSettingsSchema, default: () => ({}) },
    defaultDeposit: { type: DefaultDepositPolicySchema, default: () => ({}) },
    reminders: { type: ReminderSettingsSchema, default: () => ({}) },
  },
  { timestamps: true, optimisticConcurrency: true },
);

SalonSettingsSchema.index({ salonId: 1 }, { unique: true });

SalonSettingsSchema.pre("validate", function () {
  if (!this.defaultDeposit || !this.reminders) {
    if (!this.defaultDeposit) this.invalidate("defaultDeposit", "Default deposit policy is required");
    if (!this.reminders) this.invalidate("reminders", "Reminder settings are required");
    return;
  }

  const deposit = this.defaultDeposit;

  if (deposit.type === "fixed" && deposit.fixedAmountMinor === undefined) {
    this.invalidate("defaultDeposit.fixedAmountMinor", "A fixed deposit amount is required");
  }

  if (deposit.type === "percentage" && deposit.percentage === undefined) {
    this.invalidate("defaultDeposit.percentage", "A deposit percentage is required");
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

const SalonSettings = getOrCreateModel<ISalonSettings>("SalonSettings", SalonSettingsSchema);

export { SalonSettingsSchema };
export default SalonSettings;
