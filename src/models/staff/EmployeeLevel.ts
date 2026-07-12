import { Schema } from "mongoose";

import { getOrCreateModel, normalizeCode } from "../core/shared.js";

export interface IEmployeeLevel {
  name: string;
  code: string;
  rank: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeLevelSchema = new Schema<IEmployeeLevel>(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    code: { type: String, required: true, set: normalizeCode, maxlength: 24 },
    rank: { type: Number, required: true, min: 0, max: 1000 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

EmployeeLevelSchema.index({ code: 1 }, { unique: true });
EmployeeLevelSchema.index({ rank: 1 });

const EmployeeLevel = getOrCreateModel<IEmployeeLevel>("EmployeeLevel", EmployeeLevelSchema);

export { EmployeeLevelSchema };
export default EmployeeLevel;
