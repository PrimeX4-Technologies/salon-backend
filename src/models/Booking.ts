import { randomUUID } from "node:crypto";

import { Schema, type Types } from "mongoose";

import {
  CURRENCY_PATTERN,
  E164_PHONE_PATTERN,
  EMAIL_PATTERN,
  getOrCreateModel,
  isNonNegativeInteger,
  isValidTimeZone,
  normalizeEmail,
  normalizePhone,
} from "./shared.js";

export const BOOKING_STATUSES = [
  "requested",
  "pending_deposit",
  "confirmed",
  "checked_in",
  "in_progress",
  "completed",
  "cancelled",
  "no_show",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

interface IBookingCustomerSnapshot {
  name: string;
  email?: string;
  phone?: string;
}

interface IBookingPriceSnapshot {
  currency: string;
  subtotalMinor: number;
  depositRequiredMinor: number;
  depositPaidMinor: number;
}

interface ICancellationPolicySnapshot {
  cancellationWindowHours: number;
  lateCancellationChargePercentage: number;
  noShowChargePercentage: number;
}

interface IBookingEventDetails {
  type: "standard" | "group" | "bridal" | "offsite";
  name?: string;
  partySize: number;
  travelMinutesBefore: number;
  travelMinutesAfter: number;
  offsiteAddress?: string;
}

export interface IBooking {
  salonId: Types.ObjectId;
  locationId: Types.ObjectId;
  customerId: Types.ObjectId;
  reference: string;
  idempotencyKey?: string;
  source: "online" | "admin" | "walk_in" | "api" | "external";
  status: BookingStatus;
  startAt: Date;
  endAt: Date;
  timeZone: string;
  customerSnapshot: IBookingCustomerSnapshot;
  priceSnapshot: IBookingPriceSnapshot;
  cancellationPolicySnapshot: ICancellationPolicySnapshot;
  event: IBookingEventDetails;
  customerNote?: string;
  internalNote?: string;
  expiresAt?: Date;
  confirmedAt?: Date;
  checkedInAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  createdByUserId?: Types.ObjectId;
  updatedByUserId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSnapshotSchema = new Schema<IBookingCustomerSnapshot>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    email: { type: String, set: normalizeEmail, match: EMAIL_PATTERN, maxlength: 254 },
    phone: { type: String, set: normalizePhone, match: E164_PHONE_PATTERN },
  },
  { _id: false },
);

const BookingPriceSnapshotSchema = new Schema<IBookingPriceSnapshot>(
  {
    currency: { type: String, required: true, uppercase: true, match: CURRENCY_PATTERN },
    subtotalMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must be integer minor units" },
    },
    depositRequiredMinor: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must be integer minor units" },
    },
    depositPaidMinor: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must be integer minor units" },
    },
  },
  { _id: false },
);

const CancellationPolicySnapshotSchema = new Schema<ICancellationPolicySnapshot>(
  {
    cancellationWindowHours: { type: Number, required: true, min: 0, max: 720 },
    lateCancellationChargePercentage: { type: Number, default: 0, min: 0, max: 100 },
    noShowChargePercentage: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false },
);

const BookingEventDetailsSchema = new Schema<IBookingEventDetails>(
  {
    type: { type: String, enum: ["standard", "group", "bridal", "offsite"], default: "standard" },
    name: { type: String, trim: true, maxlength: 160 },
    partySize: { type: Number, default: 1, min: 1, max: 100 },
    travelMinutesBefore: { type: Number, default: 0, min: 0, max: 1440 },
    travelMinutesAfter: { type: Number, default: 0, min: 0, max: 1440 },
    offsiteAddress: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false },
);

const BookingSchema = new Schema<IBooking>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    locationId: { type: Schema.Types.ObjectId, ref: "SalonLocation", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    reference: {
      type: String,
      required: true,
      default: () => `BKG-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`,
      immutable: true,
    },
    idempotencyKey: { type: String, trim: true, maxlength: 200, select: false },
    source: {
      type: String,
      enum: ["online", "admin", "walk_in", "api", "external"],
      required: true,
    },
    status: { type: String, enum: BOOKING_STATUSES, default: "requested" },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    timeZone: {
      type: String,
      required: true,
      validate: { validator: isValidTimeZone, message: "Invalid IANA time zone" },
    },
    customerSnapshot: { type: CustomerSnapshotSchema, required: true },
    priceSnapshot: { type: BookingPriceSnapshotSchema, required: true },
    cancellationPolicySnapshot: { type: CancellationPolicySnapshotSchema, required: true },
    event: { type: BookingEventDetailsSchema, default: () => ({}) },
    customerNote: { type: String, trim: true, maxlength: 2000 },
    internalNote: { type: String, trim: true, maxlength: 5000, select: false },
    expiresAt: Date,
    confirmedAt: Date,
    checkedInAt: Date,
    completedAt: Date,
    cancelledAt: Date,
    cancellationReason: { type: String, trim: true, maxlength: 1000 },
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    updatedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, optimisticConcurrency: true },
);

BookingSchema.index({ salonId: 1, reference: 1 }, { unique: true });
BookingSchema.index(
  { salonId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);
BookingSchema.index({ salonId: 1, locationId: 1, status: 1, startAt: 1 });
BookingSchema.index({ salonId: 1, customerId: 1, startAt: -1 });
BookingSchema.index({ salonId: 1, status: 1, expiresAt: 1 });

BookingSchema.pre("validate", function () {
  if (this.endAt <= this.startAt) {
    this.invalidate("endAt", "Booking must end after it starts");
  }

  if (!this.priceSnapshot || !this.event) {
    if (!this.priceSnapshot) this.invalidate("priceSnapshot", "Booking price snapshot is required");
    if (!this.event) this.invalidate("event", "Booking event details are required");
    return;
  }

  if (this.priceSnapshot.depositPaidMinor > this.priceSnapshot.subtotalMinor) {
    this.invalidate("priceSnapshot.depositPaidMinor", "Paid deposit cannot exceed the booking subtotal");
  }

  if (this.priceSnapshot.depositRequiredMinor > this.priceSnapshot.subtotalMinor) {
    this.invalidate(
      "priceSnapshot.depositRequiredMinor",
      "Required deposit cannot exceed the booking subtotal",
    );
  }

  if (this.event.type === "offsite" && !this.event.offsiteAddress) {
    this.invalidate("event.offsiteAddress", "An off-site booking requires an address");
  }
});

const Booking = getOrCreateModel<IBooking>("Booking", BookingSchema);

export { BookingSchema };
export default Booking;
