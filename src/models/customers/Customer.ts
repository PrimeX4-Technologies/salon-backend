import { Schema, type Types } from "mongoose";

import {
  E164_PHONE_PATTERN,
  EMAIL_PATTERN,
  getOrCreateModel,
  isValidLocalDate,
  normalizeEmail,
  normalizePhone,
} from "../core/shared.js";

export interface ICustomer {
  userId?: Types.ObjectId;
  name: string;
  preferredName?: string;
  email?: string;
  phone?: string;
  gender: "male" | "female" | "non_binary" | "prefer_not_to_say" | "unspecified";
  dateOfBirth?: string;
  preferredBranchId?: Types.ObjectId;
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
    dateOfBirth: {
      type: String,
      validate: { validator: isValidLocalDate, message: "Date of birth must be YYYY-MM-DD" },
    },
    preferredBranchId: { type: Schema.Types.ObjectId, ref: "Branch" },
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
  { userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } },
);
CustomerSchema.index({ email: 1 });
CustomerSchema.index({ phone: 1 });
CustomerSchema.index({ name: 1 });
CustomerSchema.index({ status: 1, updatedAt: -1 });

CustomerSchema.pre("validate", function () {
  this.tags = [...new Set((this.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];

  // Future-date checks belong in the service so they use config.TIME_ZONE.
});

const Customer = getOrCreateModel<ICustomer>("Customer", CustomerSchema);

export { CustomerSchema };
export default Customer;
