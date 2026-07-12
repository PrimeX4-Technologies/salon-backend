import { Schema } from "mongoose";

import {
  AddressSchema,
  E164_PHONE_PATTERN,
  EMAIL_PATTERN,
  type IAddress,
  getOrCreateModel,
  normalizeCode,
  normalizeEmail,
  normalizePhone,
} from "../core/shared.js";

export interface IBranch {
  name: string;
  code: string;
  email?: string;
  phone?: string;
  address?: IAddress;
  isPrimary: boolean;
  isActive: boolean;
  bookingsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BranchSchema = new Schema<IBranch>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
    code: { type: String, required: true, set: normalizeCode, minlength: 2, maxlength: 24 },
    email: { type: String, set: normalizeEmail, match: EMAIL_PATTERN, maxlength: 254 },
    phone: { type: String, set: normalizePhone, match: E164_PHONE_PATTERN },
    address: AddressSchema,
    isPrimary: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    bookingsEnabled: { type: Boolean, default: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

BranchSchema.index({ code: 1 }, { unique: true });
BranchSchema.index(
  { isPrimary: 1 },
  { unique: true, partialFilterExpression: { isPrimary: true } },
);
BranchSchema.index({ isActive: 1, bookingsEnabled: 1 });

const Branch = getOrCreateModel<IBranch>("Branch", BranchSchema);

export { BranchSchema };
export default Branch;
