import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "../core/shared.js";

export interface ICalendarReservation {
  branchId: Types.ObjectId;
  resourceType: "employee" | "branch" | "chair" | "room" | "equipment";
  resourceId: Types.ObjectId;
  sourceType: "booking_item" | "calendar_block" | "temporary_hold";
  sourceId: Types.ObjectId;
  bookingId?: Types.ObjectId;
  phaseKey: string;
  startAt: Date;
  endAt: Date;
  units: number;
  status: "held" | "confirmed" | "released";
  holdExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CalendarReservationSchema = new Schema<ICalendarReservation>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    resourceType: {
      type: String,
      enum: ["employee", "branch", "chair", "room", "equipment"],
      required: true,
    },
    resourceId: { type: Schema.Types.ObjectId, required: true },
    sourceType: {
      type: String,
      enum: ["booking_item", "calendar_block", "temporary_hold"],
      required: true,
    },
    sourceId: { type: Schema.Types.ObjectId, required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking" },
    phaseKey: { type: String, required: true, trim: true, maxlength: 80 },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    units: { type: Number, default: 1, min: 1, max: 100 },
    status: { type: String, enum: ["held", "confirmed", "released"], required: true },
    holdExpiresAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);

const modifiesReservationState = (update: unknown): boolean => {
  if (Array.isArray(update)) return true;
  if (!update || typeof update !== "object") return false;
  return Object.entries(update as Record<string, unknown>).some(([path, value]) => {
    if (path.startsWith("$")) return modifiesReservationState(value);
    return ["status", "holdExpiresAt"].includes(path.split(".")[0]);
  });
};

CalendarReservationSchema.index(
  { resourceType: 1, resourceId: 1, status: 1, startAt: 1, endAt: 1 },
  { name: "availability_lookup" },
);
CalendarReservationSchema.index(
  { sourceType: 1, sourceId: 1, resourceType: 1, resourceId: 1, phaseKey: 1 },
  { unique: true },
);
CalendarReservationSchema.index({ branchId: 1, status: 1, startAt: 1 });
CalendarReservationSchema.index({ bookingId: 1 });
CalendarReservationSchema.index({ holdExpiresAt: 1 }, { expireAfterSeconds: 0 });

CalendarReservationSchema.pre("validate", function () {
  if (this.endAt <= this.startAt) {
    this.invalidate("endAt", "Reservation must end after it starts");
  }
  if (this.status === "held" && !this.holdExpiresAt) {
    this.invalidate("holdExpiresAt", "A temporary hold requires an expiry");
  }
  if (this.status === "held" && this.holdExpiresAt && this.holdExpiresAt <= new Date()) {
    this.invalidate("holdExpiresAt", "A temporary hold must expire in the future");
  }
  if (this.status !== "held") this.holdExpiresAt = undefined;
});

CalendarReservationSchema.pre(["updateOne", "updateMany", "findOneAndUpdate"], function () {
  if (modifiesReservationState(this.getUpdate())) {
    throw new Error("Reservation state must be changed on a document with save()");
  }
});

CalendarReservationSchema.pre(["replaceOne", "findOneAndReplace"], function () {
  throw new Error("Reservation replacements are disabled; load the document and call save()");
});

CalendarReservationSchema.pre("bulkWrite", function () {
  throw new Error("Reservation bulk writes are disabled to protect hold expiry state");
});

const CalendarReservation = getOrCreateModel<ICalendarReservation>(
  "CalendarReservation",
  CalendarReservationSchema,
);

export { CalendarReservationSchema };
export default CalendarReservation;
