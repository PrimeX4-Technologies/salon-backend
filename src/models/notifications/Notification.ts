import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "../core/shared.js";

export interface INotification {
  recipientType: "user" | "customer" | "employee";
  recipientId: Types.ObjectId;
  bookingId?: Types.ObjectId;
  channel: "email" | "sms" | "whatsapp" | "push";
  topic: "booking_update" | "reminder" | "waitlist_update" | "staff_schedule" | "marketing" | "system";
  destination: string;
  templateKey: string;
  locale: string;
  variables: Map<string, string>;
  idempotencyKey: string;
  status: "queued" | "processing" | "sent" | "failed" | "cancelled";
  scheduledAt: Date;
  nextAttemptAt?: Date;
  attempts: number;
  maxAttempts: number;
  lockedAt?: Date;
  lockedBy?: string;
  lockExpiresAt?: Date;
  providerMessageId?: string;
  sentAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    recipientType: { type: String, enum: ["user", "customer", "employee"], required: true },
    recipientId: { type: Schema.Types.ObjectId, required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking" },
    channel: { type: String, enum: ["email", "sms", "whatsapp", "push"], required: true },
    topic: {
      type: String,
      enum: ["booking_update", "reminder", "waitlist_update", "staff_schedule", "marketing", "system"],
      required: true,
    },
    destination: { type: String, required: true, trim: true, maxlength: 500, select: false },
    templateKey: { type: String, required: true, trim: true, lowercase: true, maxlength: 100 },
    locale: { type: String, default: "en", trim: true, maxlength: 20 },
    variables: { type: Map, of: String, default: () => new Map(), select: false },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 200, select: false },
    status: {
      type: String,
      enum: ["queued", "processing", "sent", "failed", "cancelled"],
      default: "queued",
    },
    scheduledAt: { type: Date, required: true, default: Date.now },
    nextAttemptAt: Date,
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 5, min: 1, max: 20 },
    lockedAt: Date,
    lockedBy: { type: String, trim: true, maxlength: 200, select: false },
    lockExpiresAt: Date,
    providerMessageId: { type: String, trim: true, maxlength: 255, select: false },
    sentAt: Date,
    lastError: { type: String, trim: true, maxlength: 2000, select: false },
  },
  { timestamps: true },
);

NotificationSchema.index({ idempotencyKey: 1 }, { unique: true });
NotificationSchema.index({
  status: 1,
  scheduledAt: 1,
  nextAttemptAt: 1,
  lockExpiresAt: 1,
});
NotificationSchema.index({ recipientType: 1, recipientId: 1, createdAt: -1 });
NotificationSchema.index({ bookingId: 1, topic: 1 });

NotificationSchema.pre("validate", function () {
  if (
    this.status === "processing" &&
    (!this.lockedAt || !this.lockedBy || !this.lockExpiresAt)
  ) {
    this.invalidate(
      "lockExpiresAt",
      "A processing notification requires a complete worker lease",
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

const Notification = getOrCreateModel<INotification>("Notification", NotificationSchema);

export { NotificationSchema };
export default Notification;
