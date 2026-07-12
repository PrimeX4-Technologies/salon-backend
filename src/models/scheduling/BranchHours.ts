import { Schema, type Types } from "mongoose";

import {
  type ITimeInterval,
  TimeIntervalSchema,
  getOrCreateModel,
  intervalsAreValid,
  isValidLocalDate,
} from "../core/shared.js";

interface IBranchHoursDay {
  dayOfWeek: number;
  isClosed: boolean;
  intervals: ITimeInterval[];
}

export interface IBranchHours {
  branchId: Types.ObjectId;
  name: string;
  effectiveFrom: string;
  effectiveUntil?: string;
  days: IBranchHoursDay[];
  status: "draft" | "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

const BranchHoursDaySchema = new Schema<IBranchHoursDay>(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    isClosed: { type: Boolean, default: false },
    intervals: { type: [TimeIntervalSchema], default: [] },
  },
  { _id: false },
);

const BranchHoursSchema = new Schema<IBranchHours>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    effectiveFrom: {
      type: String,
      required: true,
      validate: { validator: isValidLocalDate, message: "Effective date must be YYYY-MM-DD" },
    },
    effectiveUntil: {
      type: String,
      validate: { validator: isValidLocalDate, message: "Effective date must be YYYY-MM-DD" },
    },
    days: { type: [BranchHoursDaySchema], required: true },
    status: { type: String, enum: ["draft", "active", "archived"], default: "draft" },
  },
  { timestamps: true, optimisticConcurrency: true },
);

BranchHoursSchema.index({ branchId: 1, status: 1, effectiveFrom: -1 });
BranchHoursSchema.index({ branchId: 1, effectiveFrom: 1, effectiveUntil: 1 });

BranchHoursSchema.pre("validate", function () {
  if (this.effectiveUntil && this.effectiveUntil <= this.effectiveFrom) {
    this.invalidate("effectiveUntil", "Effective end must be after effective start");
  }

  this.days = this.days ?? [];
  const dayNumbers = this.days.map((day) => day.dayOfWeek);
  if (new Set(dayNumbers).size !== dayNumbers.length) {
    this.invalidate("days", "Each weekday can appear only once");
  }

  this.days.forEach((day, index) => {
    day.intervals = day.intervals ?? [];
    if (day.isClosed && day.intervals.length > 0) {
      this.invalidate(`days.${index}.intervals`, "Closed days cannot contain opening intervals");
    }
    if (!day.isClosed && day.intervals.length === 0) {
      this.invalidate(`days.${index}.intervals`, "Open days require an opening interval");
    }
    if (!day.isClosed && !intervalsAreValid(day.intervals)) {
      this.invalidate(`days.${index}.intervals`, "Opening intervals must be non-overlapping");
    }
  });
});

const BranchHours = getOrCreateModel<IBranchHours>("BranchHours", BranchHoursSchema);

export { BranchHoursSchema };
export default BranchHours;
