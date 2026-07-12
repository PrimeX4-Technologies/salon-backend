import { Schema, type Types } from "mongoose";

import {
  AdvancePolicySchema,
  type IAdvancePolicy,
  type IPricePresentation,
  PricePresentationSchema,
} from "../core/pricing.js";
import { getOrCreateModel } from "../core/shared.js";
import { ServiceDurationSchema, type IServiceDuration } from "./Service.js";

export interface IBranchService {
  branchId: Types.ObjectId;
  serviceId: Types.ObjectId;
  priceOverride?: IPricePresentation;
  durationOverride?: IServiceDuration;
  advancePolicyOverride?: IAdvancePolicy;
  isActive: boolean;
  isOnlineBookable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BranchServiceSchema = new Schema<IBranchService>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true },
    priceOverride: PricePresentationSchema,
    durationOverride: ServiceDurationSchema,
    advancePolicyOverride: AdvancePolicySchema,
    isActive: { type: Boolean, default: true },
    isOnlineBookable: { type: Boolean, default: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

BranchServiceSchema.index({ branchId: 1, serviceId: 1 }, { unique: true });
BranchServiceSchema.index({ branchId: 1, isActive: 1, isOnlineBookable: 1 });
BranchServiceSchema.index({ serviceId: 1, isActive: 1 });

const BranchService = getOrCreateModel<IBranchService>("BranchService", BranchServiceSchema);

export { BranchServiceSchema };
export default BranchService;
