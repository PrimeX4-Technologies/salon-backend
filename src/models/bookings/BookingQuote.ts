import { Schema, type Types } from "mongoose";

import type { AdvanceRequirement } from "../core/pricing.js";
import { CURRENCY_PATTERN, getOrCreateModel, isNonNegativeInteger } from "../core/shared.js";

interface IQuoteLine {
  type: "service" | "product" | "custom";
  serviceId?: Types.ObjectId;
  productId?: Types.ObjectId;
  name: string;
  description?: string;
  quantity: number;
  durationMinutes?: number;
  amountMinor: number;
  employeeId?: Types.ObjectId;
}

export interface IBookingQuote {
  inquiryId: Types.ObjectId;
  revision: number;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired" | "superseded";
  validUntil: Date;
  branchId: Types.ObjectId;
  proposedStartAt?: Date;
  proposedEndAt?: Date;
  currency: string;
  lines: IQuoteLine[];
  quotedTotalMinor: number;
  advanceRequirement: AdvanceRequirement;
  advanceDueMinor: number;
  terms?: string;
  sentAt?: Date;
  acceptedAt?: Date;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const QuoteLineSchema = new Schema<IQuoteLine>(
  {
    type: { type: String, enum: ["service", "product", "custom"], required: true },
    serviceId: { type: Schema.Types.ObjectId, ref: "Service" },
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 2000 },
    quantity: { type: Number, required: true, min: 1, max: 500 },
    durationMinutes: { type: Number, min: 1, max: 10_080 },
    amountMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must use integer minor units" },
    },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee" },
  },
  { _id: true },
);

const BookingQuoteSchema = new Schema<IBookingQuote>(
  {
    inquiryId: { type: Schema.Types.ObjectId, ref: "BookingInquiry", required: true },
    revision: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ["draft", "sent", "accepted", "rejected", "expired", "superseded"],
      default: "draft",
    },
    validUntil: { type: Date, required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    proposedStartAt: Date,
    proposedEndAt: Date,
    currency: { type: String, required: true, uppercase: true, match: CURRENCY_PATTERN },
    lines: { type: [QuoteLineSchema], required: true },
    quotedTotalMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must use integer minor units" },
    },
    advanceRequirement: {
      type: String,
      enum: ["none", "optional", "required"],
      default: "none",
    },
    advanceDueMinor: {
      type: Number,
      default: 0,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must use integer minor units" },
    },
    terms: { type: String, trim: true, maxlength: 20_000 },
    sentAt: Date,
    acceptedAt: Date,
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

BookingQuoteSchema.index({ inquiryId: 1, revision: 1 }, { unique: true });
BookingQuoteSchema.index(
  { inquiryId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "accepted" } },
);
BookingQuoteSchema.index({ status: 1, validUntil: 1 });

BookingQuoteSchema.pre("validate", function () {
  this.lines = this.lines ?? [];
  if (this.lines.length === 0) this.invalidate("lines", "A quote requires at least one line");
  const calculatedTotal = this.lines.reduce((total, line) => total + line.amountMinor, 0);
  if (calculatedTotal !== this.quotedTotalMinor) {
    this.invalidate("quotedTotalMinor", "Quote total must equal the sum of line amounts");
  }
  this.lines.forEach((line, index) => {
    if (line.type === "service" && (!line.serviceId || !line.durationMinutes)) {
      this.invalidate(`lines.${index}.serviceId`, "Service quote lines require a service and duration");
    }
    if (line.type === "product" && !line.productId) {
      this.invalidate(`lines.${index}.productId`, "Product quote lines require a product");
    }
    if (line.type !== "service" && line.serviceId) {
      this.invalidate(`lines.${index}.serviceId`, "Only service lines may reference a service");
    }
    if (line.type !== "product" && line.productId) {
      this.invalidate(`lines.${index}.productId`, "Only product lines may reference a product");
    }
  });
  if (this.advanceDueMinor > this.quotedTotalMinor) {
    this.invalidate("advanceDueMinor", "Advance cannot exceed the quoted total");
  }
  if (this.advanceRequirement === "none" && this.advanceDueMinor > 0) {
    this.invalidate("advanceDueMinor", "No advance can be due when advances are disabled");
  }
  if (this.advanceRequirement === "required" && this.advanceDueMinor === 0) {
    this.invalidate("advanceDueMinor", "A required advance must be greater than zero");
  }
  if (this.proposedStartAt && this.proposedEndAt && this.proposedEndAt <= this.proposedStartAt) {
    this.invalidate("proposedEndAt", "Proposed end must be after proposed start");
  }
  if (this.status === "accepted" && !this.acceptedAt) {
    this.invalidate("acceptedAt", "An accepted quote requires acceptedAt");
  }
});

const BookingQuote = getOrCreateModel<IBookingQuote>("BookingQuote", BookingQuoteSchema);

export { BookingQuoteSchema };
export default BookingQuote;
