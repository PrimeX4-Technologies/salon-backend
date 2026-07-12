import { Schema, type Types } from "mongoose";

import {
  AddressSchema,
  type IAddress,
  E164_PHONE_PATTERN,
  EMAIL_PATTERN,
  getOrCreateModel,
  isValidTimeZone,
  normalizeCode,
  normalizeEmail,
  normalizePhone,
} from "./shared.js";

export interface ISalonLocation {
  salonId: Types.ObjectId;
  name: string;
  code: string;
  timeZone: string;
  email?: string;
  phone?: string;
  address?: IAddress;
  isActive: boolean;
  bookingsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SalonLocationSchema = new Schema<ISalonLocation>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true, index: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
    code: { type: String, required: true, set: normalizeCode, minlength: 2, maxlength: 24 },
    timeZone: {
      type: String,
      required: true,
      validate: { validator: isValidTimeZone, message: "Invalid IANA time zone" },
    },
    email: { type: String, set: normalizeEmail, match: EMAIL_PATTERN, maxlength: 254 },
    phone: { type: String, set: normalizePhone, match: E164_PHONE_PATTERN },
    address: AddressSchema,
    isActive: { type: Boolean, default: true },
    bookingsEnabled: { type: Boolean, default: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

SalonLocationSchema.index({ salonId: 1, code: 1 }, { unique: true });
SalonLocationSchema.index({ salonId: 1, isActive: 1, bookingsEnabled: 1 });

const SalonLocation = getOrCreateModel<ISalonLocation>("SalonLocation", SalonLocationSchema);

export { SalonLocationSchema };
export default SalonLocation;
