import { Schema, type Types } from "mongoose";

import {
  CURRENCY_PATTERN,
  getOrCreateModel,
  isNonNegativeInteger,
  normalizeCode,
} from "./shared.js";

export interface IServiceDuration {
  applicationMinutes: number;
  processingMinutes: number;
  finishingMinutes: number;
  bufferMinutes: number;
  processingBlocksEmployee: boolean;
}

interface IServiceTierPrice {
  employeeLevelId: Types.ObjectId;
  amountMinor: number;
}

interface IServiceDepositPolicy {
  type: "inherit" | "none" | "fixed" | "percentage";
  fixedAmountMinor?: number;
  percentage?: number;
}

export interface IService {
  salonId: Types.ObjectId;
  categoryId: Types.ObjectId;
  locationIds: Types.ObjectId[];
  code: string;
  name: string;
  slug: string;
  description?: string;
  targetClientGender: "male" | "female" | "all";
  requiredSkillIds: Types.ObjectId[];
  duration: IServiceDuration;
  currency: string;
  basePriceMinor: number;
  tierPrices: IServiceTierPrice[];
  depositPolicy: IServiceDepositPolicy;
  isActive: boolean;
  isOnlineBookable: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceDurationSchema = new Schema<IServiceDuration>(
  {
    applicationMinutes: { type: Number, required: true, min: 0, max: 1440 },
    processingMinutes: { type: Number, default: 0, min: 0, max: 1440 },
    finishingMinutes: { type: Number, default: 0, min: 0, max: 1440 },
    bufferMinutes: { type: Number, default: 0, min: 0, max: 240 },
    processingBlocksEmployee: { type: Boolean, default: true },
  },
  { _id: false },
);

const ServiceTierPriceSchema = new Schema<IServiceTierPrice>(
  {
    employeeLevelId: { type: Schema.Types.ObjectId, ref: "EmployeeLevel", required: true },
    amountMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Price must be integer minor units" },
    },
  },
  { _id: false },
);

const ServiceDepositPolicySchema = new Schema<IServiceDepositPolicy>(
  {
    type: {
      type: String,
      enum: ["inherit", "none", "fixed", "percentage"],
      default: "inherit",
    },
    fixedAmountMinor: {
      type: Number,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must be integer minor units" },
    },
    percentage: { type: Number, min: 0, max: 100 },
  },
  { _id: false },
);

const ServiceSchema = new Schema<IService>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "ServiceCategory", required: true },
    locationIds: [{ type: Schema.Types.ObjectId, ref: "SalonLocation", required: true }],
    code: { type: String, required: true, set: normalizeCode, maxlength: 40 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    description: { type: String, trim: true, maxlength: 5000 },
    targetClientGender: { type: String, enum: ["male", "female", "all"], default: "all" },
    requiredSkillIds: [{ type: Schema.Types.ObjectId, ref: "Skill" }],
    duration: { type: ServiceDurationSchema, required: true },
    currency: { type: String, required: true, uppercase: true, match: CURRENCY_PATTERN },
    basePriceMinor: {
      type: Number,
      required: true,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Price must be integer minor units" },
    },
    tierPrices: { type: [ServiceTierPriceSchema], default: [] },
    depositPolicy: { type: ServiceDepositPolicySchema, default: () => ({}) },
    isActive: { type: Boolean, default: true },
    isOnlineBookable: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, optimisticConcurrency: true },
);

ServiceSchema.index({ salonId: 1, code: 1 }, { unique: true });
ServiceSchema.index({ salonId: 1, slug: 1 }, { unique: true });
ServiceSchema.index({ salonId: 1, locationIds: 1, isActive: 1, isOnlineBookable: 1 });
ServiceSchema.index({ salonId: 1, categoryId: 1, isActive: 1, sortOrder: 1 });
ServiceSchema.index({ salonId: 1, requiredSkillIds: 1 });

ServiceSchema.pre("validate", function () {
  this.locationIds = [
    ...new Map((this.locationIds ?? []).map((id) => [id.toString(), id])).values(),
  ];
  this.requiredSkillIds = [
    ...new Map((this.requiredSkillIds ?? []).map((id) => [id.toString(), id])).values(),
  ];
  this.tierPrices = this.tierPrices ?? [];

  if (this.locationIds.length === 0) {
    this.invalidate("locationIds", "At least one service location is required");
  }

  if (!this.duration) {
    this.invalidate("duration", "Service duration is required");
    return;
  }

  const totalMinutes =
    this.duration.applicationMinutes +
    this.duration.processingMinutes +
    this.duration.finishingMinutes +
    this.duration.bufferMinutes;
  if (totalMinutes <= 0) {
    this.invalidate("duration", "Total service duration must be greater than zero");
  }

  const levelIds = this.tierPrices.map((price) => price.employeeLevelId.toString());
  if (new Set(levelIds).size !== levelIds.length) {
    this.invalidate("tierPrices", "An employee level can have only one price");
  }

  if (!this.depositPolicy) {
    this.invalidate("depositPolicy", "Deposit policy is required");
    return;
  }

  if (this.depositPolicy.type === "fixed" && this.depositPolicy.fixedAmountMinor === undefined) {
    this.invalidate("depositPolicy.fixedAmountMinor", "A fixed deposit amount is required");
  }

  if (this.depositPolicy.type === "percentage" && this.depositPolicy.percentage === undefined) {
    this.invalidate("depositPolicy.percentage", "A deposit percentage is required");
  }
});

const Service = getOrCreateModel<IService>("Service", ServiceSchema);

export { ServiceSchema };
export default Service;
