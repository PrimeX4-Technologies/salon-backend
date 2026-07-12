import { Schema } from "mongoose";

import { getOrCreateModel, normalizeCode } from "../core/shared.js";

export interface ISkill {
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SkillSchema = new Schema<ISkill>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    code: { type: String, required: true, set: normalizeCode, maxlength: 32 },
    description: { type: String, trim: true, maxlength: 1000 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

SkillSchema.index({ code: 1 }, { unique: true });
SkillSchema.index({ isActive: 1, name: 1 });

const Skill = getOrCreateModel<ISkill>("Skill", SkillSchema);

export { SkillSchema };
export default Skill;
