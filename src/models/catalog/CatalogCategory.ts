import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "../core/shared.js";

export interface ICatalogCategory {
  parentId?: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  appliesTo: Array<"service" | "product" | "package">;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CatalogCategorySchema = new Schema<ICatalogCategory>(
  {
    parentId: { type: Schema.Types.ObjectId, ref: "CatalogCategory" },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    slug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
      match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    },
    description: { type: String, trim: true, maxlength: 1000 },
    appliesTo: {
      type: [{ type: String, enum: ["service", "product", "package"] }],
      default: ["service"],
    },
    sortOrder: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

CatalogCategorySchema.index({ slug: 1 }, { unique: true });
CatalogCategorySchema.index({ parentId: 1, isActive: 1, sortOrder: 1 });
CatalogCategorySchema.index({ appliesTo: 1, isActive: 1, sortOrder: 1 });

CatalogCategorySchema.pre("validate", function () {
  this.appliesTo = [...new Set(this.appliesTo ?? [])];
  if (this.appliesTo.length === 0) {
    this.invalidate("appliesTo", "A category must apply to at least one catalog type");
  }
  if (this.parentId && this._id.equals(this.parentId)) {
    this.invalidate("parentId", "A category cannot be its own parent");
  }
});

const CatalogCategory = getOrCreateModel<ICatalogCategory>(
  "CatalogCategory",
  CatalogCategorySchema,
);

export { CatalogCategorySchema };
export default CatalogCategory;
