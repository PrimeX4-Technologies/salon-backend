import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "../core/shared.js";

export interface ICalendarBlock {
  branchId: Types.ObjectId;
  employeeId?: Types.ObjectId;
  type: "branch_closed" | "break" | "meeting" | "training" | "maintenance" | "travel" | "manual" | "other";
  source: "manual" | "time_off" | "booking" | "holiday" | "integration";
  sourceId?: Types.ObjectId;
  title: string;
  note?: string;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  blocksBookings: boolean;
  status: "active" | "cancelled";
  createdByUserId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CalendarBlockSchema = new Schema<ICalendarBlock>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee" },
    type: {
      type: String,
      enum: ["branch_closed", "break", "meeting", "training", "maintenance", "travel", "manual", "other"],
      required: true,
    },
    source: {
      type: String,
      enum: ["manual", "time_off", "booking", "holiday", "integration"],
      default: "manual",
    },
    sourceId: Schema.Types.ObjectId,
    title: { type: String, required: true, trim: true, maxlength: 160 },
    note: { type: String, trim: true, maxlength: 2000, select: false },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    allDay: { type: Boolean, default: false },
    blocksBookings: { type: Boolean, default: true },
    status: { type: String, enum: ["active", "cancelled"], default: "active" },
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, optimisticConcurrency: true },
);

CalendarBlockSchema.index({ branchId: 1, status: 1, startAt: 1, endAt: 1 });
CalendarBlockSchema.index({ employeeId: 1, status: 1, startAt: 1, endAt: 1 });
CalendarBlockSchema.index(
  { source: 1, sourceId: 1 },
  { partialFilterExpression: { sourceId: { $type: "objectId" } } },
);

CalendarBlockSchema.pre("validate", function () {
  if (this.endAt <= this.startAt) {
    this.invalidate("endAt", "Calendar block must end after it starts");
  }
  if (this.type === "branch_closed" && this.employeeId) {
    this.invalidate("employeeId", "A branch closure cannot target one employee");
  }
});

const CalendarBlock = getOrCreateModel<ICalendarBlock>("CalendarBlock", CalendarBlockSchema);

export { CalendarBlockSchema };
export default CalendarBlock;
