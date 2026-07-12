import { Schema, type Types } from "mongoose";

import {
  E164_PHONE_PATTERN,
  EMAIL_PATTERN,
  HEX_COLOR_PATTERN,
  getOrCreateModel,
  normalizeCode,
  normalizeEmail,
  normalizePhone,
} from "./shared.js";

export interface IEmployee {
  salonId: Types.ObjectId;
  userId?: Types.ObjectId;
  employeeCode: string;
  name: string;
  title?: string;
  levelId?: Types.ObjectId;
  workEmail?: string;
  workPhone?: string;
  locationIds: Types.ObjectId[];
  primaryLocationId?: Types.ObjectId;
  employmentType: "full_time" | "part_time" | "contractor" | "temporary";
  status: "invited" | "active" | "on_leave" | "inactive" | "terminated";
  isBookable: boolean;
  acceptsOnlineBookings: boolean;
  servesClientGender: "male" | "female" | "all";
  maxConcurrentClients: number;
  bio?: string;
  avatarUrl?: string;
  calendarColor: string;
  hireDate?: Date;
  terminationDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeSchema = new Schema<IEmployee>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    employeeCode: { type: String, required: true, set: normalizeCode, minlength: 1, maxlength: 32 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
    title: { type: String, trim: true, maxlength: 100 },
    levelId: { type: Schema.Types.ObjectId, ref: "EmployeeLevel" },
    workEmail: { type: String, set: normalizeEmail, match: EMAIL_PATTERN, maxlength: 254 },
    workPhone: { type: String, set: normalizePhone, match: E164_PHONE_PATTERN },
    locationIds: [{ type: Schema.Types.ObjectId, ref: "SalonLocation" }],
    primaryLocationId: { type: Schema.Types.ObjectId, ref: "SalonLocation" },
    employmentType: {
      type: String,
      enum: ["full_time", "part_time", "contractor", "temporary"],
      default: "full_time",
    },
    status: {
      type: String,
      enum: ["invited", "active", "on_leave", "inactive", "terminated"],
      default: "invited",
    },
    isBookable: { type: Boolean, default: false },
    acceptsOnlineBookings: { type: Boolean, default: false },
    servesClientGender: { type: String, enum: ["male", "female", "all"], default: "all" },
    maxConcurrentClients: { type: Number, min: 1, max: 5, default: 1 },
    bio: { type: String, trim: true, maxlength: 2000 },
    avatarUrl: { type: String, trim: true, maxlength: 2048 },
    calendarColor: { type: String, uppercase: true, match: HEX_COLOR_PATTERN, default: "#2563EB" },
    hireDate: Date,
    terminationDate: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);

EmployeeSchema.index({ salonId: 1, employeeCode: 1 }, { unique: true });
EmployeeSchema.index(
  { salonId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } },
);
EmployeeSchema.index({ salonId: 1, locationIds: 1, status: 1, isBookable: 1 });
EmployeeSchema.index({ salonId: 1, levelId: 1, status: 1 });

EmployeeSchema.pre("validate", function () {
  this.locationIds = [
    ...new Map((this.locationIds ?? []).map((id) => [id.toString(), id])).values(),
  ];

  if (this.primaryLocationId && !this.locationIds.some((id) => id.equals(this.primaryLocationId))) {
    this.invalidate("primaryLocationId", "Primary location must be included in locationIds");
  }

  if (this.terminationDate && this.hireDate && this.terminationDate <= this.hireDate) {
    this.invalidate("terminationDate", "Termination date must be later than the hire date");
  }

  if (this.status === "active" && !this.userId) {
    this.invalidate("userId", "An active employee must have a local-login user account");
  }

  if (this.status === "active" && this.locationIds.length === 0) {
    this.invalidate("locationIds", "An active employee must be assigned to at least one location");
  }

  if (this.status !== "active" && this.isBookable) {
    this.invalidate("isBookable", "Only active employees can be bookable");
  }

  if (this.acceptsOnlineBookings && !this.isBookable) {
    this.invalidate("acceptsOnlineBookings", "Online bookings require the employee to be bookable");
  }
});

const Employee = getOrCreateModel<IEmployee>("Employee", EmployeeSchema);

export { EmployeeSchema };
export default Employee;
