import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "./shared.js";

export interface ICalendarReservation {
  salonId: Types.ObjectId;
  locationId: Types.ObjectId;
  resourceType: "employee" | "location" | "chair" | "room" | "equipment";
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
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    locationId: { type: Schema.Types.ObjectId, ref: "SalonLocation", required: true },
    resourceType: {
      type: String,
      enum: ["employee", "location", "chair", "room", "equipment"],
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

CalendarReservationSchema.index(
  { salonId: 1, resourceType: 1, resourceId: 1, status: 1, startAt: 1, endAt: 1 },
  { name: "availability_lookup" },
);
CalendarReservationSchema.index(
  { sourceType: 1, sourceId: 1, resourceType: 1, resourceId: 1, phaseKey: 1 },
  { unique: true },
);
CalendarReservationSchema.index({ status: 1, holdExpiresAt: 1 });
CalendarReservationSchema.index({ bookingId: 1 });

CalendarReservationSchema.pre("validate", function () {
  if (this.endAt <= this.startAt) {
    this.invalidate("endAt", "Reservation must end after it starts");
  }

  if (this.status === "held" && !this.holdExpiresAt) {
    this.invalidate("holdExpiresAt", "A temporary hold requires an expiry time");
  }

  if (this.status === "held" && this.holdExpiresAt && this.holdExpiresAt <= new Date()) {
    this.invalidate("holdExpiresAt", "A temporary hold must expire in the future");
  }

  if (this.status === "confirmed" && this.holdExpiresAt) {
    this.holdExpiresAt = undefined;
  }
});

const CalendarReservation = getOrCreateModel<ICalendarReservation>(
  "CalendarReservation",
  CalendarReservationSchema,
);

export { CalendarReservationSchema };
export default CalendarReservation;
