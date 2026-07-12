import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "./shared.js";

export interface IPaymentWebhookEvent {
  salonId?: Types.ObjectId;
  provider: string;
  merchantAccountId: string;
  providerEventId: string;
  eventType: string;
  encryptedPayload: string;
  payloadHash: string;
  status: "received" | "processing" | "processed" | "failed" | "ignored";
  attempts: number;
  nextAttemptAt?: Date;
  processedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentWebhookEventSchema = new Schema<IPaymentWebhookEvent>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon" },
    provider: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
    merchantAccountId: { type: String, required: true, trim: true, maxlength: 255 },
    providerEventId: { type: String, required: true, trim: true, maxlength: 255 },
    eventType: { type: String, required: true, trim: true, maxlength: 160 },
    encryptedPayload: { type: String, required: true, select: false },
    payloadHash: { type: String, required: true, trim: true, maxlength: 128, select: false },
    status: {
      type: String,
      enum: ["received", "processing", "processed", "failed", "ignored"],
      default: "received",
    },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: Date,
    processedAt: Date,
    lastError: { type: String, trim: true, maxlength: 2000, select: false },
  },
  { timestamps: true },
);

PaymentWebhookEventSchema.index(
  { provider: 1, merchantAccountId: 1, providerEventId: 1 },
  { unique: true },
);
PaymentWebhookEventSchema.index({ status: 1, nextAttemptAt: 1 });

const PaymentWebhookEvent = getOrCreateModel<IPaymentWebhookEvent>(
  "PaymentWebhookEvent",
  PaymentWebhookEventSchema,
);

export { PaymentWebhookEventSchema };
export default PaymentWebhookEvent;
