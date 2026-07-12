import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "./shared.js";

export interface ICalendarBlock {
  salonId: Types.ObjectId;
  locationId: Types.ObjectId;
  employeeId?: Types.ObjectId;
  type: "location_closed" | "break" | "meeting" | "training" | "maintenance" | "travel" | "manual" | "other";
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
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    locationId: { type: Schema.Types.ObjectId, ref: "SalonLocation", required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee" },
    type: {
      type: String,
      enum: [
        "location_closed",
        "break",
        "meeting",
        "training",
        "maintenance",
        "travel",
        "manual",
        "other",
      ],
      required: true,
    },
    source: {
      type: String,
      enum: ["manual", "time_off", "booking", "holiday", "integration"],
      default: "manual",
    },
    sourceId: { type: Schema.Types.ObjectId },
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

CalendarBlockSchema.index({ salonId: 1, locationId: 1, status: 1, startAt: 1, endAt: 1 });
CalendarBlockSchema.index({ salonId: 1, employeeId: 1, status: 1, startAt: 1, endAt: 1 });
CalendarBlockSchema.index(
  { salonId: 1, source: 1, sourceId: 1 },
  { partialFilterExpression: { sourceId: { $type: "objectId" } } },
);

CalendarBlockSchema.pre("validate", function () {
  if (this.endAt <= this.startAt) {
    this.invalidate("endAt", "Calendar block must end after it starts");
  }

  if (this.type === "location_closed" && this.employeeId) {
    this.invalidate("employeeId", "A location closure cannot target only one employee");
  }
});

const CalendarBlock = getOrCreateModel<ICalendarBlock>("CalendarBlock", CalendarBlockSchema);

export { CalendarBlockSchema };
export default CalendarBlock;
