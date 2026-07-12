import { Schema, type Types } from "mongoose";

import { getOrCreateModel, isValidLocalDate } from "../core/shared.js";

export interface IEmployeeSkill {
  employeeId: Types.ObjectId;
  skillId: Types.ObjectId;
  proficiency: "trainee" | "qualified" | "advanced" | "expert";
  certifiedAt?: string;
  expiresAt?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeSkillSchema = new Schema<IEmployeeSkill>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    skillId: { type: Schema.Types.ObjectId, ref: "Skill", required: true },
    proficiency: {
      type: String,
      enum: ["trainee", "qualified", "advanced", "expert"],
      default: "qualified",
    },
    certifiedAt: {
      type: String,
      validate: { validator: isValidLocalDate, message: "Certification date must be YYYY-MM-DD" },
    },
    expiresAt: {
      type: String,
      validate: { validator: isValidLocalDate, message: "Expiry date must be YYYY-MM-DD" },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

EmployeeSkillSchema.index({ employeeId: 1, skillId: 1 }, { unique: true });
EmployeeSkillSchema.index({ skillId: 1, proficiency: 1, isActive: 1 });

EmployeeSkillSchema.pre("validate", function () {
  if (this.expiresAt && this.certifiedAt && this.expiresAt <= this.certifiedAt) {
    this.invalidate("expiresAt", "Expiry date must be after certification date");
  }
});

const EmployeeSkill = getOrCreateModel<IEmployeeSkill>("EmployeeSkill", EmployeeSkillSchema);

export { EmployeeSkillSchema };
export default EmployeeSkill;
