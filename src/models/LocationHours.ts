import { Schema, type Types } from "mongoose";

import {
  type ITimeInterval,
  TimeIntervalSchema,
  getOrCreateModel,
  intervalsAreValid,
  isValidTimeZone,
} from "./shared.js";

interface ILocationHoursDay {
  dayOfWeek: number;
  isClosed: boolean;
  intervals: ITimeInterval[];
}

export interface ILocationHours {
  salonId: Types.ObjectId;
  locationId: Types.ObjectId;
  name: string;
  timeZone: string;
  effectiveFrom: Date;
  effectiveUntil?: Date;
  days: ILocationHoursDay[];
  status: "draft" | "active" | "archived";
  createdAt: Date;
  updatedAt: Date;
}

const LocationHoursDaySchema = new Schema<ILocationHoursDay>(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    isClosed: { type: Boolean, default: false },
    intervals: { type: [TimeIntervalSchema], default: [] },
  },
  { _id: false },
);

const LocationHoursSchema = new Schema<ILocationHours>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    locationId: { type: Schema.Types.ObjectId, ref: "SalonLocation", required: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    timeZone: {
      type: String,
      required: true,
      validate: { validator: isValidTimeZone, message: "Invalid IANA time zone" },
    },
    effectiveFrom: { type: Date, required: true },
    effectiveUntil: Date,
    days: { type: [LocationHoursDaySchema], required: true },
    status: { type: String, enum: ["draft", "active", "archived"], default: "draft" },
  },
  { timestamps: true, optimisticConcurrency: true },
);

LocationHoursSchema.index({ salonId: 1, locationId: 1, status: 1, effectiveFrom: -1 });
LocationHoursSchema.index({ locationId: 1, effectiveFrom: 1, effectiveUntil: 1 });

LocationHoursSchema.pre("validate", function () {
  if (this.effectiveUntil && this.effectiveUntil <= this.effectiveFrom) {
    this.invalidate("effectiveUntil", "Effective end must be later than effective start");
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
      this.invalidate(`days.${index}.intervals`, "Open days require at least one opening interval");
    }
    if (!day.isClosed && !intervalsAreValid(day.intervals)) {
      this.invalidate(`days.${index}.intervals`, "Opening intervals must be valid and non-overlapping");
    }
  });
});

const LocationHours = getOrCreateModel<ILocationHours>("LocationHours", LocationHoursSchema);

export { LocationHoursSchema };
export default LocationHours;
