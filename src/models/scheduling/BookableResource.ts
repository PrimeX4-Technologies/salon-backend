import { Schema, type Types } from "mongoose";

import { getOrCreateModel, normalizeCode } from "../core/shared.js";

export interface IBookableResource {
  branchId: Types.ObjectId;
  type: "chair" | "room" | "equipment";
  code: string;
  name: string;
  capacity: number;
  serviceIds: Types.ObjectId[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const BookableResourceSchema = new Schema<IBookableResource>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    type: { type: String, enum: ["chair", "room", "equipment"], required: true },
    code: { type: String, required: true, set: normalizeCode, maxlength: 32 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    capacity: { type: Number, default: 1, min: 1, max: 100 },
    serviceIds: [{ type: Schema.Types.ObjectId, ref: "Service" }],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

BookableResourceSchema.index({ branchId: 1, code: 1 }, { unique: true });
BookableResourceSchema.index({ branchId: 1, type: 1, isActive: 1 });
BookableResourceSchema.index({ branchId: 1, serviceIds: 1, isActive: 1 });

BookableResourceSchema.pre("validate", function () {
  this.serviceIds = [
    ...new Map((this.serviceIds ?? []).map((id) => [id.toString(), id])).values(),
  ];
});

const BookableResource = getOrCreateModel<IBookableResource>(
  "BookableResource",
  BookableResourceSchema,
);

export { BookableResourceSchema };
export default BookableResource;
