import { randomUUID } from "node:crypto";

import { Schema, type Types } from "mongoose";

import type { AdvanceRequirement, PriceMode } from "../core/pricing.js";
import {
  CURRENCY_PATTERN,
  E164_PHONE_PATTERN,
  EMAIL_PATTERN,
  getOrCreateModel,
  isNonNegativeInteger,
  normalizeEmail,
  normalizePhone,
} from "../core/shared.js";

export const BOOKING_STATUSES = [
  "requested",
  "pending_advance",
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

interface IBookingPricingSnapshot {
  currency: string;
  mode: PriceMode;
  displayAmountMinor?: number;
  displayFromMinor?: number;
  displayToMinor?: number;
  estimatedSubtotalMinor?: number;
  quotedSubtotalMinor?: number;
  advanceRequirement: AdvanceRequirement;
  advanceDueMinor: number;
  advancePaidMinor: number;
  customerAcceptedVariablePricingAt?: Date;
}

interface IExternalSettlementSummary {
  status: "not_tracked" | "pending_external" | "settled_external";
  externalReference?: string;
  externallyReportedFinalAmountMinor?: number;
  lastSyncedAt?: Date;
  settledAt?: Date;
}

interface IIncludedProductSnapshot {
  productId: Types.ObjectId;
  code: string;
  name: string;
  quantity: number;
}

interface IPackageSnapshot {
  packageId: Types.ObjectId;
  code: string;
  name: string;
  kind: "bundle" | "wedding" | "event";
}

interface ICancellationPolicySnapshot {
  cancellationWindowHours: number;
}

interface IBookingEventDetails {
  type: "standard" | "group" | "wedding" | "offsite";
  name?: string;
  partySize: number;
  travelMinutesBefore: number;
  travelMinutesAfter: number;
  offsiteAddress?: string;
}

export interface IBooking {
  branchId: Types.ObjectId;
  customerId: Types.ObjectId;
  quoteId?: Types.ObjectId;
  packageId?: Types.ObjectId;
  packageSnapshot?: IPackageSnapshot;
  reference: string;
  idempotencyKey?: string;
  source: "online" | "admin" | "walk_in" | "api" | "external";
  status: BookingStatus;
  startAt: Date;
  endAt: Date;
  customerSnapshot: IBookingCustomerSnapshot;
  pricingSnapshot: IBookingPricingSnapshot;
  externalSettlement: IExternalSettlementSummary;
  includedProductSnapshots: IIncludedProductSnapshot[];
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

const moneyField = {
  type: Number,
  min: 0,
  validate: { validator: isNonNegativeInteger, message: "Money must use integer minor units" },
} as const;

const BookingPricingSnapshotSchema = new Schema<IBookingPricingSnapshot>(
  {
    currency: { type: String, required: true, uppercase: true, match: CURRENCY_PATTERN },
    mode: {
      type: String,
      enum: ["fixed", "starting_from", "range", "quote_required"],
      required: true,
    },
    displayAmountMinor: moneyField,
    displayFromMinor: moneyField,
    displayToMinor: moneyField,
    estimatedSubtotalMinor: moneyField,
    quotedSubtotalMinor: moneyField,
    advanceRequirement: {
      type: String,
      enum: ["none", "optional", "required"],
      default: "none",
    },
    advanceDueMinor: { ...moneyField, default: 0, required: true },
    advancePaidMinor: { ...moneyField, default: 0, required: true },
    customerAcceptedVariablePricingAt: Date,
  },
  { _id: false },
);

const ExternalSettlementSummarySchema = new Schema<IExternalSettlementSummary>(
  {
    status: {
      type: String,
      enum: ["not_tracked", "pending_external", "settled_external"],
      default: "not_tracked",
    },
    externalReference: { type: String, trim: true, maxlength: 512 },
    externallyReportedFinalAmountMinor: moneyField,
    lastSyncedAt: Date,
    settledAt: Date,
  },
  { _id: false },
);

const IncludedProductSnapshotSchema = new Schema<IIncludedProductSnapshot>(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    code: { type: String, required: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    quantity: { type: Number, required: true, min: 1, max: 500 },
  },
  { _id: false },
);

const PackageSnapshotSchema = new Schema<IPackageSnapshot>(
  {
    packageId: { type: Schema.Types.ObjectId, required: true },
    code: { type: String, required: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    kind: { type: String, enum: ["bundle", "wedding", "event"], required: true },
  },
  { _id: false },
);

const CancellationPolicySnapshotSchema = new Schema<ICancellationPolicySnapshot>(
  {
    cancellationWindowHours: { type: Number, required: true, min: 0, max: 720 },
  },
  { _id: false },
);

const BookingEventDetailsSchema = new Schema<IBookingEventDetails>(
  {
    type: { type: String, enum: ["standard", "group", "wedding", "offsite"], default: "standard" },
    name: { type: String, trim: true, maxlength: 160 },
    partySize: { type: Number, default: 1, min: 1, max: 500 },
    travelMinutesBefore: { type: Number, default: 0, min: 0, max: 1440 },
    travelMinutesAfter: { type: Number, default: 0, min: 0, max: 1440 },
    offsiteAddress: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false },
);

const BookingSchema = new Schema<IBooking>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    quoteId: { type: Schema.Types.ObjectId, ref: "BookingQuote" },
    packageId: { type: Schema.Types.ObjectId, ref: "ServicePackage" },
    packageSnapshot: PackageSnapshotSchema,
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
    customerSnapshot: { type: CustomerSnapshotSchema, required: true },
    pricingSnapshot: { type: BookingPricingSnapshotSchema, required: true },
    externalSettlement: { type: ExternalSettlementSummarySchema, default: () => ({}) },
    includedProductSnapshots: { type: [IncludedProductSnapshotSchema], default: [] },
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

BookingSchema.index({ reference: 1 }, { unique: true });
BookingSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);
BookingSchema.index({ branchId: 1, status: 1, startAt: 1 });
BookingSchema.index({ customerId: 1, startAt: -1 });
BookingSchema.index({ status: 1, expiresAt: 1 });
BookingSchema.index(
  { quoteId: 1 },
  { unique: true, partialFilterExpression: { quoteId: { $type: "objectId" } } },
);

BookingSchema.pre("validate", function () {
  if (this.endAt <= this.startAt) this.invalidate("endAt", "Booking must end after it starts");
  if (!this.pricingSnapshot || !this.event || !this.externalSettlement) {
    if (!this.pricingSnapshot) this.invalidate("pricingSnapshot", "Pricing snapshot is required");
    if (!this.event) this.invalidate("event", "Booking event details are required");
    if (!this.externalSettlement) this.invalidate("externalSettlement", "Settlement summary is required");
    return;
  }

  const price = this.pricingSnapshot;
  this.includedProductSnapshots = this.includedProductSnapshots ?? [];
  if (price.advancePaidMinor > price.advanceDueMinor) {
    this.invalidate("pricingSnapshot.advancePaidMinor", "Advance paid cannot exceed advance due");
  }
  if (price.advanceRequirement === "none" && price.advanceDueMinor > 0) {
    this.invalidate("pricingSnapshot.advanceDueMinor", "No advance can be due when advances are disabled");
  }
  if (price.advanceRequirement === "none" && price.advancePaidMinor > 0) {
    this.invalidate("pricingSnapshot.advancePaidMinor", "An advance cannot be paid when disabled");
  }
  if (price.advanceRequirement === "required" && price.advanceDueMinor === 0) {
    this.invalidate("pricingSnapshot.advanceDueMinor", "A required advance must be greater than zero");
  }
  if (this.status === "pending_advance" && price.advanceRequirement !== "required") {
    this.invalidate("status", "Only a required advance can put a booking into pending_advance");
  }
  if (["starting_from", "range", "quote_required"].includes(price.mode) && !price.customerAcceptedVariablePricingAt) {
    this.invalidate(
      "pricingSnapshot.customerAcceptedVariablePricingAt",
      "Variable pricing requires recorded customer acknowledgement",
    );
  }
  if (price.mode === "fixed" && price.displayAmountMinor === undefined) {
    this.invalidate("pricingSnapshot.displayAmountMinor", "Fixed pricing requires its displayed amount");
  }
  if (price.mode === "fixed") {
    price.displayFromMinor = undefined;
    price.displayToMinor = undefined;
  } else if (price.mode === "starting_from") {
    price.displayAmountMinor = undefined;
    price.displayToMinor = undefined;
  } else if (price.mode === "range") {
    price.displayAmountMinor = undefined;
  } else {
    price.displayAmountMinor = undefined;
    price.displayFromMinor = undefined;
    price.displayToMinor = undefined;
  }
  if (price.mode === "starting_from" && price.displayFromMinor === undefined) {
    this.invalidate("pricingSnapshot.displayFromMinor", "Starting-from pricing requires its displayed minimum");
  }
  if (price.mode === "range") {
    if (price.displayFromMinor === undefined || price.displayToMinor === undefined) {
      this.invalidate("pricingSnapshot.displayToMinor", "Range pricing requires both displayed bounds");
    } else if (price.displayToMinor < price.displayFromMinor) {
      this.invalidate("pricingSnapshot.displayToMinor", "Displayed maximum cannot be below minimum");
    }
  }
  if (price.mode === "quote_required" && (price.quotedSubtotalMinor === undefined || !this.quoteId)) {
    this.invalidate("pricingSnapshot.quotedSubtotalMinor", "Quote-required bookings need an accepted quote and total");
  }
  if (this.event.type === "offsite" && !this.event.offsiteAddress) {
    this.invalidate("event.offsiteAddress", "An off-site booking requires an address");
  }
  if (this.externalSettlement.status === "settled_external" && !this.externalSettlement.settledAt) {
    this.invalidate("externalSettlement.settledAt", "Settled status requires settledAt");
  }

  const productIds = this.includedProductSnapshots.map((item) => item.productId.toString());
  if (new Set(productIds).size !== productIds.length) {
    this.invalidate("includedProductSnapshots", "Each included product may appear only once");
  }
  if (this.packageId && !this.packageSnapshot) {
    this.invalidate("packageSnapshot", "Package bookings require a historical package snapshot");
  }
  if (
    this.packageId &&
    this.packageSnapshot &&
    !this.packageId.equals(this.packageSnapshot.packageId)
  ) {
    this.invalidate("packageSnapshot.packageId", "Package snapshot must match packageId");
  }
});

const Booking = getOrCreateModel<IBooking>("Booking", BookingSchema);

export { BookingSchema };
export default Booking;
