import { Schema, type Types } from "mongoose";

import {
  AdvancePolicySchema,
  type IAdvancePolicy,
  type IPricePresentation,
  PricePresentationSchema,
} from "../core/pricing.js";
import { getOrCreateModel, normalizeCode } from "../core/shared.js";

interface IServicePackageComponent {
  serviceId: Types.ObjectId;
  quantity: number;
  isOptional: boolean;
}

interface IProductInclusion {
  productId: Types.ObjectId;
  quantity: number;
  isOptional: boolean;
}

export interface IServicePackage {
  categoryId: Types.ObjectId;
  branchIds: Types.ObjectId[];
  availableAtAllBranches: boolean;
  code: string;
  name: string;
  slug: string;
  description?: string;
  kind: "bundle" | "wedding" | "event";
  bookingMode: "instant" | "request_quote" | "consultation_required";
  minimumPartySize: number;
  maximumPartySize?: number;
  allowsOffsite: boolean;
  travelMinutesBefore: number;
  travelMinutesAfter: number;
  serviceComponents: IServicePackageComponent[];
  productInclusions: IProductInclusion[];
  price: IPricePresentation;
  advancePolicy?: IAdvancePolicy;
  isActive: boolean;
  isPublished: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const ServicePackageComponentSchema = new Schema<IServicePackageComponent>(
  {
    serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true },
    quantity: { type: Number, required: true, min: 1, max: 100 },
    isOptional: { type: Boolean, default: false },
  },
  { _id: false },
);

const ProductInclusionSchema = new Schema<IProductInclusion>(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    quantity: { type: Number, required: true, min: 1, max: 100 },
    isOptional: { type: Boolean, default: false },
  },
  { _id: false },
);

const ServicePackageSchema = new Schema<IServicePackage>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "CatalogCategory", required: true },
    branchIds: [{ type: Schema.Types.ObjectId, ref: "Branch" }],
    availableAtAllBranches: { type: Boolean, default: true },
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
    description: { type: String, trim: true, maxlength: 10_000 },
    kind: { type: String, enum: ["bundle", "wedding", "event"], default: "bundle" },
    bookingMode: {
      type: String,
      enum: ["instant", "request_quote", "consultation_required"],
      default: "request_quote",
    },
    minimumPartySize: { type: Number, default: 1, min: 1, max: 500 },
    maximumPartySize: { type: Number, min: 1, max: 500 },
    allowsOffsite: { type: Boolean, default: false },
    travelMinutesBefore: { type: Number, default: 0, min: 0, max: 1440 },
    travelMinutesAfter: { type: Number, default: 0, min: 0, max: 1440 },
    serviceComponents: { type: [ServicePackageComponentSchema], default: [] },
    productInclusions: { type: [ProductInclusionSchema], default: [] },
    price: { type: PricePresentationSchema, required: true },
    advancePolicy: AdvancePolicySchema,
    isActive: { type: Boolean, default: true },
    isPublished: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, optimisticConcurrency: true },
);

ServicePackageSchema.index({ code: 1 }, { unique: true });
ServicePackageSchema.index({ slug: 1 }, { unique: true });
ServicePackageSchema.index({ categoryId: 1, isActive: 1, isPublished: 1, sortOrder: 1 });
ServicePackageSchema.index({ branchIds: 1, isActive: 1, isPublished: 1 });

ServicePackageSchema.pre("validate", function () {
  this.branchIds = [
    ...new Map((this.branchIds ?? []).map((id) => [id.toString(), id])).values(),
  ];
  this.serviceComponents = this.serviceComponents ?? [];
  this.productInclusions = this.productInclusions ?? [];

  if (this.availableAtAllBranches) this.branchIds = [];
  if (!this.availableAtAllBranches && this.branchIds.length === 0) {
    this.invalidate("branchIds", "Select at least one branch or enable all branches");
  }
  if (this.serviceComponents.length === 0) {
    this.invalidate("serviceComponents", "A package must include at least one service");
  }
  if (this.maximumPartySize && this.maximumPartySize < this.minimumPartySize) {
    this.invalidate("maximumPartySize", "Maximum party size cannot be below the minimum");
  }
  if (!this.allowsOffsite && (this.travelMinutesBefore > 0 || this.travelMinutesAfter > 0)) {
    this.invalidate("allowsOffsite", "Travel buffers require off-site service support");
  }

  const serviceIds = this.serviceComponents.map((item) => item.serviceId.toString());
  if (new Set(serviceIds).size !== serviceIds.length) {
    this.invalidate("serviceComponents", "Each service may appear only once in a package");
  }
  const productIds = this.productInclusions.map((item) => item.productId.toString());
  if (new Set(productIds).size !== productIds.length) {
    this.invalidate("productInclusions", "Each product may appear only once in a package");
  }
});

const ServicePackage = getOrCreateModel<IServicePackage>(
  "ServicePackage",
  ServicePackageSchema,
);

export { ServicePackageSchema };
export default ServicePackage;
