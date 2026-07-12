import { Schema, type Types } from "mongoose";

import {
  AdvancePolicySchema,
  type IAdvancePolicy,
  type IPricePresentation,
  PricePresentationSchema,
} from "../core/pricing.js";
import { getOrCreateModel, normalizeCode } from "../core/shared.js";

export interface IServiceDuration {
  applicationMinutes: number;
  processingMinutes: number;
  finishingMinutes: number;
  bufferMinutes: number;
  processingBlocksEmployee: boolean;
}

interface IServiceTierPrice {
  employeeLevelId: Types.ObjectId;
  price: IPricePresentation;
}

export interface IService {
  categoryId: Types.ObjectId;
  code: string;
  name: string;
  slug: string;
  description?: string;
  targetClientGender: "male" | "female" | "all";
  requiredSkillIds: Types.ObjectId[];
  duration: IServiceDuration;
  price: IPricePresentation;
  tierPrices: IServiceTierPrice[];
  advancePolicy?: IAdvancePolicy;
  bookingMode: "instant" | "request" | "consultation_required";
  isActive: boolean;
  isOnlineBookable: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export const ServiceDurationSchema = new Schema<IServiceDuration>(
  {
    applicationMinutes: { type: Number, required: true, min: 0, max: 1440 },
    processingMinutes: { type: Number, default: 0, min: 0, max: 1440 },
    finishingMinutes: { type: Number, default: 0, min: 0, max: 1440 },
    bufferMinutes: { type: Number, default: 0, min: 0, max: 240 },
    processingBlocksEmployee: { type: Boolean, default: true },
  },
  { _id: false },
);

ServiceDurationSchema.pre("validate", function () {
  const totalMinutes =
    this.applicationMinutes +
    this.processingMinutes +
    this.finishingMinutes +
    this.bufferMinutes;
  if (totalMinutes <= 0) this.invalidate("applicationMinutes", "Total duration must be positive");
});

const ServiceTierPriceSchema = new Schema<IServiceTierPrice>(
  {
    employeeLevelId: { type: Schema.Types.ObjectId, ref: "EmployeeLevel", required: true },
    price: { type: PricePresentationSchema, required: true },
  },
  { _id: false },
);

const ServiceSchema = new Schema<IService>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "CatalogCategory", required: true },
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
    price: { type: PricePresentationSchema, required: true },
    tierPrices: { type: [ServiceTierPriceSchema], default: [] },
    advancePolicy: AdvancePolicySchema,
    bookingMode: {
      type: String,
      enum: ["instant", "request", "consultation_required"],
      default: "instant",
    },
    isActive: { type: Boolean, default: true },
    isOnlineBookable: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, optimisticConcurrency: true },
);

ServiceSchema.index({ code: 1 }, { unique: true });
ServiceSchema.index({ slug: 1 }, { unique: true });
ServiceSchema.index({ categoryId: 1, isActive: 1, sortOrder: 1 });
ServiceSchema.index({ requiredSkillIds: 1, isActive: 1 });
ServiceSchema.index({ isActive: 1, isOnlineBookable: 1, bookingMode: 1 });

ServiceSchema.pre("validate", function () {
  this.requiredSkillIds = [
    ...new Map((this.requiredSkillIds ?? []).map((id) => [id.toString(), id])).values(),
  ];
  this.tierPrices = this.tierPrices ?? [];

  if (!this.duration) {
    this.invalidate("duration", "Service duration is required");
    return;
  }

  const levelIds = this.tierPrices.map((tier) => tier.employeeLevelId.toString());
  if (new Set(levelIds).size !== levelIds.length) {
    this.invalidate("tierPrices", "An employee level can have only one service price");
  }

  if (this.isOnlineBookable && this.bookingMode === "consultation_required") {
    this.isOnlineBookable = false;
  }
});

const Service = getOrCreateModel<IService>("Service", ServiceSchema);

export { ServiceSchema };
export default Service;
