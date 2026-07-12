import { Schema, type Types } from "mongoose";

import { getOrCreateModel, normalizeCode } from "./shared.js";

export interface ISkill {
  salonId: Types.ObjectId;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SkillSchema = new Schema<ISkill>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, set: normalizeCode, maxlength: 32 },
    description: { type: String, trim: true, maxlength: 1000 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

SkillSchema.index({ salonId: 1, code: 1 }, { unique: true });
SkillSchema.index({ salonId: 1, isActive: 1, name: 1 });

const Skill = getOrCreateModel<ISkill>("Skill", SkillSchema);

export { SkillSchema };
export default Skill;
