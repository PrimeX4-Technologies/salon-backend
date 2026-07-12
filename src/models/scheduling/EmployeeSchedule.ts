import { Schema, type Types } from "mongoose";

import {
  type ITimeInterval,
  TimeIntervalSchema,
  getOrCreateModel,
  intervalsAreValid,
  isValidLocalDate,
  timeToMinutes,
} from "../core/shared.js";

interface IEmployeeScheduleDay {
  dayOfWeek: number;
  shifts: ITimeInterval[];
  breaks: ITimeInterval[];
}

export interface IEmployeeSchedule {
  branchId: Types.ObjectId;
  employeeId: Types.ObjectId;
  name: string;
  effectiveFrom: string;
  effectiveUntil?: string;
  days: IEmployeeScheduleDay[];
  status: "draft" | "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeScheduleDaySchema = new Schema<IEmployeeScheduleDay>(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    shifts: { type: [TimeIntervalSchema], default: [] },
    breaks: { type: [TimeIntervalSchema], default: [] },
  },
  { _id: false },
);

const EmployeeScheduleSchema = new Schema<IEmployeeSchedule>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
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
    days: { type: [EmployeeScheduleDaySchema], required: true },
    status: { type: String, enum: ["draft", "active", "archived"], default: "draft" },
  },
  { timestamps: true, optimisticConcurrency: true },
);

EmployeeScheduleSchema.index({ employeeId: 1, branchId: 1, status: 1 });
EmployeeScheduleSchema.index({ employeeId: 1, branchId: 1, effectiveFrom: 1, effectiveUntil: 1 });

EmployeeScheduleSchema.pre("validate", function () {
  if (this.effectiveUntil && this.effectiveUntil <= this.effectiveFrom) {
    this.invalidate("effectiveUntil", "Effective end must be after effective start");
  }

  this.days = this.days ?? [];
  const dayNumbers = this.days.map((day) => day.dayOfWeek);
  if (new Set(dayNumbers).size !== dayNumbers.length) {
    this.invalidate("days", "Each weekday can appear only once");
  }

  this.days.forEach((day, index) => {
    day.shifts = day.shifts ?? [];
    day.breaks = day.breaks ?? [];
    if (!intervalsAreValid(day.shifts)) {
      this.invalidate(`days.${index}.shifts`, "Shifts must be valid and non-overlapping");
    }
    if (!intervalsAreValid(day.breaks)) {
      this.invalidate(`days.${index}.breaks`, "Breaks must be valid and non-overlapping");
    }

    const breaksAreInsideShifts = day.breaks.every((breakInterval) =>
      day.shifts.some(
        (shift) =>
          timeToMinutes(shift.start) <= timeToMinutes(breakInterval.start) &&
          timeToMinutes(breakInterval.end) <= timeToMinutes(shift.end),
      ),
    );
    if (!breaksAreInsideShifts) {
      this.invalidate(`days.${index}.breaks`, "Every break must be inside a shift");
    }
  });
});

const EmployeeSchedule = getOrCreateModel<IEmployeeSchedule>(
  "EmployeeSchedule",
  EmployeeScheduleSchema,
);

export { EmployeeScheduleSchema };
export default EmployeeSchedule;
