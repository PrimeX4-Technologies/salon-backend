import { Schema, type Types } from "mongoose";

import { type IPricePresentation, PricePresentationSchema } from "../core/pricing.js";
import { getOrCreateModel, normalizeCode } from "../core/shared.js";

export interface IProduct {
  categoryId: Types.ObjectId;
  branchIds: Types.ObjectId[];
  availableAtAllBranches: boolean;
  code: string;
  sku?: string;
  barcode?: string;
  name: string;
  slug: string;
  brand?: string;
  description?: string;
  imageUrls: string[];
  price: IPricePresentation;
  purchaseMode: "in_store" | "external_link" | "inquiry";
  externalPurchaseUrl?: string;
  isActive: boolean;
  isPublished: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "CatalogCategory", required: true },
    branchIds: [{ type: Schema.Types.ObjectId, ref: "Branch" }],
    availableAtAllBranches: { type: Boolean, default: true },
    code: { type: String, required: true, set: normalizeCode, maxlength: 40 },
    sku: { type: String, trim: true, maxlength: 80 },
    barcode: { type: String, trim: true, maxlength: 80 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    brand: { type: String, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 5000 },
    imageUrls: [{ type: String, trim: true, maxlength: 2048 }],
    price: { type: PricePresentationSchema, required: true },
    purchaseMode: {
      type: String,
      enum: ["in_store", "external_link", "inquiry"],
      default: "in_store",
    },
    externalPurchaseUrl: { type: String, trim: true, maxlength: 2048 },
    isActive: { type: Boolean, default: true },
    isPublished: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, optimisticConcurrency: true },
);

ProductSchema.index({ code: 1 }, { unique: true });
ProductSchema.index({ slug: 1 }, { unique: true });
ProductSchema.index(
  { sku: 1 },
  { unique: true, partialFilterExpression: { sku: { $type: "string" } } },
);
ProductSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: "string" } } },
);
ProductSchema.index({ categoryId: 1, isActive: 1, isPublished: 1, sortOrder: 1 });
ProductSchema.index({ branchIds: 1, isActive: 1, isPublished: 1 });

ProductSchema.pre("validate", function () {
  this.branchIds = [
    ...new Map((this.branchIds ?? []).map((id) => [id.toString(), id])).values(),
  ];
  this.imageUrls = [...new Set((this.imageUrls ?? []).map((url) => url.trim()).filter(Boolean))];

  if (this.availableAtAllBranches) this.branchIds = [];
  if (!this.availableAtAllBranches && this.branchIds.length === 0) {
    this.invalidate("branchIds", "Select at least one branch or enable all branches");
  }
  if (this.purchaseMode === "external_link" && !this.externalPurchaseUrl) {
    this.invalidate("externalPurchaseUrl", "External-link products require a purchase URL");
  }
});

const Product = getOrCreateModel<IProduct>("Product", ProductSchema);

export { ProductSchema };
export default Product;
