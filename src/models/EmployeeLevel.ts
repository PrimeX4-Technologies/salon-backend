import { Schema, type Types } from "mongoose";

import { getOrCreateModel, normalizeCode } from "./shared.js";

export interface IEmployeeLevel {
  salonId: Types.ObjectId;
  name: string;
  code: string;
  rank: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeLevelSchema = new Schema<IEmployeeLevel>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, set: normalizeCode, maxlength: 24 },
    rank: { type: Number, required: true, min: 0, max: 1000 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

EmployeeLevelSchema.index({ salonId: 1, code: 1 }, { unique: true });
EmployeeLevelSchema.index({ salonId: 1, rank: 1 });

const EmployeeLevel = getOrCreateModel<IEmployeeLevel>("EmployeeLevel", EmployeeLevelSchema);

export { EmployeeLevelSchema };
export default EmployeeLevel;
