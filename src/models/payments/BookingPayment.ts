import { Schema, type Types } from "mongoose";

import { CURRENCY_PATTERN, getOrCreateModel, isNonNegativeInteger } from "../core/shared.js";

export interface IBookingPayment {
  branchId: Types.ObjectId;
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  purpose: "advance" | "advance_refund" | "cancellation_fee" | "no_show_fee";
  provider: string;
  merchantAccountId?: string;
  providerTransactionId?: string;
  idempotencyKey: string;
  amountMinor: number;
  currency: string;
  status: "pending" | "authorized" | "succeeded" | "failed" | "cancelled" | "refunded";
  paymentMethodType?: "card" | "bank_transfer" | "cash" | "wallet" | "external";
  relatedPaymentId?: Types.ObjectId;
  failureCode?: string;
  failureMessage?: string;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BookingPaymentSchema = new Schema<IBookingPayment>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    purpose: {
      type: String,
      enum: ["advance", "advance_refund", "cancellation_fee", "no_show_fee"],
      required: true,
    },
    provider: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    merchantAccountId: { type: String, trim: true, maxlength: 255, select: false },
    providerTransactionId: { type: String, trim: true, maxlength: 255, select: false },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 200, select: false },
    amountMinor: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: isNonNegativeInteger, message: "Money must use integer minor units" },
    },
    currency: { type: String, required: true, uppercase: true, match: CURRENCY_PATTERN },
    status: {
      type: String,
      enum: ["pending", "authorized", "succeeded", "failed", "cancelled", "refunded"],
      default: "pending",
    },
    paymentMethodType: {
      type: String,
      enum: ["card", "bank_transfer", "cash", "wallet", "external"],
    },
    relatedPaymentId: { type: Schema.Types.ObjectId, ref: "BookingPayment" },
    failureCode: { type: String, trim: true, maxlength: 100, select: false },
    failureMessage: { type: String, trim: true, maxlength: 1000, select: false },
    processedAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);

BookingPaymentSchema.index({ provider: 1, idempotencyKey: 1 }, { unique: true });
BookingPaymentSchema.index(
  { provider: 1, merchantAccountId: 1, providerTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerTransactionId: { $type: "string" } },
  },
);
BookingPaymentSchema.index({ branchId: 1, bookingId: 1, status: 1, createdAt: -1 });
BookingPaymentSchema.index({ customerId: 1, createdAt: -1 });

BookingPaymentSchema.pre("validate", function () {
  if (this.purpose === "advance_refund" && !this.relatedPaymentId) {
    this.invalidate("relatedPaymentId", "An advance refund must reference the original payment");
  }
  if (this.purpose !== "advance_refund" && this.relatedPaymentId) {
    this.invalidate("relatedPaymentId", "Only advance refunds reference an original payment");
  }
});

const BookingPayment = getOrCreateModel<IBookingPayment>("BookingPayment", BookingPaymentSchema);

export { BookingPaymentSchema };
export default BookingPayment;
