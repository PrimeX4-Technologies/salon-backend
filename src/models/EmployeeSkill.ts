import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "./shared.js";

export interface IEmployeeSkill {
  salonId: Types.ObjectId;
  employeeId: Types.ObjectId;
  skillId: Types.ObjectId;
  proficiency: "trainee" | "qualified" | "advanced" | "expert";
  certifiedAt?: Date;
  expiresAt?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeSkillSchema = new Schema<IEmployeeSkill>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    skillId: { type: Schema.Types.ObjectId, ref: "Skill", required: true },
    proficiency: {
      type: String,
      enum: ["trainee", "qualified", "advanced", "expert"],
      default: "qualified",
    },
    certifiedAt: Date,
    expiresAt: Date,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

EmployeeSkillSchema.index({ salonId: 1, employeeId: 1, skillId: 1 }, { unique: true });
EmployeeSkillSchema.index({ salonId: 1, skillId: 1, proficiency: 1, isActive: 1 });

EmployeeSkillSchema.pre("validate", function () {
  if (this.expiresAt && this.certifiedAt && this.expiresAt <= this.certifiedAt) {
    this.invalidate("expiresAt", "Expiry date must be later than certification date");
  }
});

const EmployeeSkill = getOrCreateModel<IEmployeeSkill>("EmployeeSkill", EmployeeSkillSchema);

export { EmployeeSkillSchema };
export default EmployeeSkill;
