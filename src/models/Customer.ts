import { Schema, type Types } from "mongoose";

import {
  E164_PHONE_PATTERN,
  EMAIL_PATTERN,
  getOrCreateModel,
  normalizeEmail,
  normalizePhone,
} from "./shared.js";

export interface ICustomer {
  salonId: Types.ObjectId;
  userId?: Types.ObjectId;
  name: string;
  preferredName?: string;
  email?: string;
  phone?: string;
  gender: "male" | "female" | "non_binary" | "prefer_not_to_say" | "unspecified";
  dateOfBirth?: Date;
  preferredLocationId?: Types.ObjectId;
  preferredEmployeeId?: Types.ObjectId;
  tags: string[];
  internalNotes?: string;
  source: "online" | "admin" | "walk_in" | "erp_import" | "api";
  status: "active" | "blocked" | "archived";
  createdByUserId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CustomerSchema = new Schema<ICustomer>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
    preferredName: { type: String, trim: true, maxlength: 80 },
    email: { type: String, set: normalizeEmail, match: EMAIL_PATTERN, maxlength: 254 },
    phone: { type: String, set: normalizePhone, match: E164_PHONE_PATTERN },
    gender: {
      type: String,
      enum: ["male", "female", "non_binary", "prefer_not_to_say", "unspecified"],
      default: "unspecified",
    },
    dateOfBirth: Date,
    preferredLocationId: { type: Schema.Types.ObjectId, ref: "SalonLocation" },
    preferredEmployeeId: { type: Schema.Types.ObjectId, ref: "Employee" },
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 40 }],
    internalNotes: { type: String, trim: true, maxlength: 5000, select: false },
    source: {
      type: String,
      enum: ["online", "admin", "walk_in", "erp_import", "api"],
      default: "online",
    },
    status: { type: String, enum: ["active", "blocked", "archived"], default: "active" },
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, optimisticConcurrency: true },
);

CustomerSchema.index(
  { salonId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } },
);
CustomerSchema.index({ salonId: 1, email: 1 });
CustomerSchema.index({ salonId: 1, phone: 1 });
CustomerSchema.index({ salonId: 1, name: 1 });
CustomerSchema.index({ salonId: 1, status: 1, updatedAt: -1 });

CustomerSchema.pre("validate", function () {
  this.tags = [
    ...new Set((this.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean)),
  ];

  if (this.dateOfBirth && this.dateOfBirth.getTime() > Date.now()) {
    this.invalidate("dateOfBirth", "Date of birth cannot be in the future");
  }
});

const Customer = getOrCreateModel<ICustomer>("Customer", CustomerSchema);

export { CustomerSchema };
export default Customer;
