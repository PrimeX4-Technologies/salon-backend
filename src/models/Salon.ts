import { Schema } from "mongoose";

import {
  E164_PHONE_PATTERN,
  EMAIL_PATTERN,
  getOrCreateModel,
  isValidTimeZone,
  normalizeEmail,
  normalizePhone,
} from "./shared.js";

export interface ISalon {
  name: string;
  legalName?: string;
  slug: string;
  status: "trial" | "active" | "suspended" | "closed";
  timeZone: string;
  email?: string;
  phone?: string;
  websiteUrl?: string;
  logoUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const SalonSchema = new Schema<ISalon>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
    legalName: { type: String, trim: true, maxlength: 200 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 80,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    status: {
      type: String,
      enum: ["trial", "active", "suspended", "closed"],
      default: "trial",
      index: true,
    },
    timeZone: {
      type: String,
      required: true,
      validate: { validator: isValidTimeZone, message: "Invalid IANA time zone" },
    },
    email: { type: String, set: normalizeEmail, match: EMAIL_PATTERN, maxlength: 254 },
    phone: { type: String, set: normalizePhone, match: E164_PHONE_PATTERN },
    websiteUrl: { type: String, trim: true, maxlength: 2048 },
    logoUrl: { type: String, trim: true, maxlength: 2048 },
  },
  { timestamps: true, optimisticConcurrency: true },
);

SalonSchema.index({ slug: 1 }, { unique: true });

const Salon = getOrCreateModel<ISalon>("Salon", SalonSchema);

export { SalonSchema };
export default Salon;
