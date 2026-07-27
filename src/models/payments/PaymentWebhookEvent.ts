import { Schema } from "mongoose";

import { getOrCreateModel } from "../core/shared.js";

export interface IPaymentWebhookEvent {
  provider: string;
  merchantAccountId: string;
  providerEventId: string;
  eventType: string;
  encryptedPayload: string;
  payloadHash: string;
  status: "received" | "processing" | "processed" | "failed" | "ignored";
  attempts: number;
  nextAttemptAt?: Date;
  lockedAt?: Date;
  lockedBy?: string;
  lockExpiresAt?: Date;
  processedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentWebhookEventSchema = new Schema<IPaymentWebhookEvent>(
  {
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
    lockedAt: Date,
    lockedBy: { type: String, trim: true, maxlength: 200, select: false },
    lockExpiresAt: Date,
    processedAt: Date,
    lastError: { type: String, trim: true, maxlength: 2000, select: false },
  },
  { timestamps: true, optimisticConcurrency: true },
);

PaymentWebhookEventSchema.index(
  { provider: 1, merchantAccountId: 1, providerEventId: 1 },
  { unique: true },
);
PaymentWebhookEventSchema.index({
  status: 1,
  nextAttemptAt: 1,
  lockExpiresAt: 1,
});

PaymentWebhookEventSchema.pre("validate", function () {
  if (
    this.status === "processing" &&
    (!this.lockedAt || !this.lockedBy || !this.lockExpiresAt)
  ) {
    this.invalidate(
      "lockExpiresAt",
      "A processing webhook requires a complete worker lease",
    );
  }
  if (
    this.lockedAt &&
    this.lockExpiresAt &&
    this.lockExpiresAt <= this.lockedAt
  ) {
    this.invalidate("lockExpiresAt", "Worker lease must expire after it starts");
  }
  if (this.status !== "processing") {
    this.lockedAt = undefined;
    this.lockedBy = undefined;
    this.lockExpiresAt = undefined;
  }
});

const PaymentWebhookEvent = getOrCreateModel<IPaymentWebhookEvent>(
  "PaymentWebhookEvent",
  PaymentWebhookEventSchema,
);

export { PaymentWebhookEventSchema };
export default PaymentWebhookEvent;
