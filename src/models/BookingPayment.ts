import { Schema, type Types } from "mongoose";

import { CURRENCY_PATTERN, getOrCreateModel, isNonNegativeInteger } from "./shared.js";

export interface IBookingPayment {
  salonId: Types.ObjectId;
  bookingId: Types.ObjectId;
  customerId: Types.ObjectId;
  type: "deposit" | "advance" | "cancellation_fee" | "no_show_fee" | "refund";
  provider: string;
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
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    type: {
      type: String,
      enum: ["deposit", "advance", "cancellation_fee", "no_show_fee", "refund"],
      required: true,
    },
    provider: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    providerTransactionId: { type: String, trim: true, maxlength: 255, select: false },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 200, select: false },
    amountMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must be integer minor units" },
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

BookingPaymentSchema.index({ salonId: 1, idempotencyKey: 1 }, { unique: true });
BookingPaymentSchema.index(
  { salonId: 1, provider: 1, providerTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerTransactionId: { $type: "string" } },
  },
);
BookingPaymentSchema.index({ salonId: 1, bookingId: 1, status: 1, createdAt: -1 });
BookingPaymentSchema.index({ salonId: 1, customerId: 1, createdAt: -1 });

BookingPaymentSchema.pre("validate", function () {
  if (this.type === "refund" && !this.relatedPaymentId) {
    this.invalidate("relatedPaymentId", "A refund must reference its original booking payment");
  }
});

const BookingPayment = getOrCreateModel<IBookingPayment>("BookingPayment", BookingPaymentSchema);

export { BookingPaymentSchema };
export default BookingPayment;
