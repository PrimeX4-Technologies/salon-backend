import { randomUUID } from "node:crypto";

import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "../core/shared.js";

export interface IOutboxEvent {
  eventId: string;
  aggregateType: "booking" | "booking_quote" | "waitlist" | "employee_schedule" | "time_off" | "booking_payment" | "catalog";
  aggregateId: Types.ObjectId;
  eventType: string;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "published" | "failed";
  attempts: number;
  nextAttemptAt?: Date;
  lockedAt?: Date;
  lockedBy?: string;
  lockExpiresAt?: Date;
  publishedAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OutboxEventSchema = new Schema<IOutboxEvent>(
  {
    eventId: { type: String, required: true, default: () => randomUUID(), immutable: true },
    aggregateType: {
      type: String,
      enum: ["booking", "booking_quote", "waitlist", "employee_schedule", "time_off", "booking_payment", "catalog"],
      required: true,
    },
    aggregateId: { type: Schema.Types.ObjectId, required: true },
    eventType: { type: String, required: true, trim: true, maxlength: 160 },
    payload: { type: Schema.Types.Mixed, required: true, select: false },
    status: { type: String, enum: ["pending", "processing", "published", "failed"], default: "pending" },
    attempts: { type: Number, default: 0, min: 0 },
    nextAttemptAt: Date,
    lockedAt: Date,
    lockedBy: { type: String, trim: true, maxlength: 200 },
    lockExpiresAt: Date,
    publishedAt: Date,
    lastError: { type: String, trim: true, maxlength: 2000, select: false },
  },
  { timestamps: true },
);

OutboxEventSchema.index({ eventId: 1 }, { unique: true });
OutboxEventSchema.index({ status: 1, nextAttemptAt: 1, lockExpiresAt: 1, createdAt: 1 });
OutboxEventSchema.index({ aggregateType: 1, aggregateId: 1, createdAt: 1 });

OutboxEventSchema.pre("validate", function () {
  if (this.status === "processing" && (!this.lockedAt || !this.lockedBy || !this.lockExpiresAt)) {
    this.invalidate("lockExpiresAt", "A processing outbox event requires a complete worker lease");
  }

  if (this.lockExpiresAt && this.lockedAt && this.lockExpiresAt <= this.lockedAt) {
    this.invalidate("lockExpiresAt", "Worker lease must expire after it starts");
  }
});

const OutboxEvent = getOrCreateModel<IOutboxEvent>("OutboxEvent", OutboxEventSchema);

export { OutboxEventSchema };
export default OutboxEvent;
