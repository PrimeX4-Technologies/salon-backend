import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "./shared.js";

export interface IServiceCategory {
  salonId: Types.ObjectId;
  name: string;
  slug: string;
  description?: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ServiceCategorySchema = new Schema<IServiceCategory>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
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
    sortOrder: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

ServiceCategorySchema.index({ salonId: 1, slug: 1 }, { unique: true });
ServiceCategorySchema.index({ salonId: 1, isActive: 1, sortOrder: 1 });

const ServiceCategory = getOrCreateModel<IServiceCategory>(
  "ServiceCategory",
  ServiceCategorySchema,
);

export { ServiceCategorySchema };
export default ServiceCategory;
