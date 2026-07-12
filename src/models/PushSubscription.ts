import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "./shared.js";

export interface IPushSubscription {
  salonId: Types.ObjectId;
  userId: Types.ObjectId;
  provider: "fcm" | "apns" | "web_push";
  platform: "web" | "ios" | "android";
  deviceId: string;
  encryptedToken: string;
  tokenHash: string;
  status: "active" | "invalid" | "revoked";
  lastSeenAt: Date;
  invalidatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    provider: { type: String, enum: ["fcm", "apns", "web_push"], required: true },
    platform: { type: String, enum: ["web", "ios", "android"], required: true },
    deviceId: { type: String, required: true, trim: true, maxlength: 255 },
    encryptedToken: { type: String, required: true, select: false },
    tokenHash: { type: String, required: true, trim: true, maxlength: 128, select: false },
    status: { type: String, enum: ["active", "invalid", "revoked"], default: "active" },
    lastSeenAt: { type: Date, required: true, default: Date.now },
    invalidatedAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);

PushSubscriptionSchema.index({ salonId: 1, userId: 1, provider: 1, deviceId: 1 }, { unique: true });
PushSubscriptionSchema.index({ tokenHash: 1 }, { unique: true });
PushSubscriptionSchema.index({ salonId: 1, userId: 1, status: 1 });

PushSubscriptionSchema.pre("validate", function () {
  if (this.status !== "active" && !this.invalidatedAt) {
    this.invalidatedAt = new Date();
  }
});

const PushSubscription = getOrCreateModel<IPushSubscription>(
  "PushSubscription",
  PushSubscriptionSchema,
);

export { PushSubscriptionSchema };
export default PushSubscription;
