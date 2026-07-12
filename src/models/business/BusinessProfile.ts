import { Schema } from "mongoose";

import {
  AddressSchema,
  E164_PHONE_PATTERN,
  EMAIL_PATTERN,
  type IAddress,
  getOrCreateModel,
  normalizeEmail,
  normalizePhone,
} from "../core/shared.js";

export interface IBusinessProfile {
  singletonKey: "default";
  name: string;
  legalName?: string;
  slug: string;
  status: "active" | "inactive" | "closed";
  email?: string;
  phone?: string;
  websiteUrl?: string;
  logoUrl?: string;
  registeredAddress?: IAddress;
  createdAt: Date;
  updatedAt: Date;
}

const BusinessProfileSchema = new Schema<IBusinessProfile>(
  {
    singletonKey: {
      type: String,
      enum: ["default"],
      default: "default",
      required: true,
      immutable: true,
    },
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
    status: { type: String, enum: ["active", "inactive", "closed"], default: "active" },
    email: { type: String, set: normalizeEmail, match: EMAIL_PATTERN, maxlength: 254 },
    phone: { type: String, set: normalizePhone, match: E164_PHONE_PATTERN },
    websiteUrl: { type: String, trim: true, maxlength: 2048 },
    logoUrl: { type: String, trim: true, maxlength: 2048 },
    registeredAddress: AddressSchema,
  },
  { timestamps: true, optimisticConcurrency: true },
);

BusinessProfileSchema.index({ singletonKey: 1 }, { unique: true });
BusinessProfileSchema.index({ slug: 1 }, { unique: true });

const BusinessProfile = getOrCreateModel<IBusinessProfile>(
  "BusinessProfile",
  BusinessProfileSchema,
);

export { BusinessProfileSchema };
export default BusinessProfile;
