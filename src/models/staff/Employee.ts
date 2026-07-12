import { Schema, type Types } from "mongoose";

import {
  E164_PHONE_PATTERN,
  EMAIL_PATTERN,
  HEX_COLOR_PATTERN,
  getOrCreateModel,
  isValidLocalDate,
  normalizeCode,
  normalizeEmail,
  normalizePhone,
} from "../core/shared.js";

export interface IEmployee {
  userId?: Types.ObjectId;
  employeeCode: string;
  name: string;
  title?: string;
  levelId?: Types.ObjectId;
  workEmail?: string;
  workPhone?: string;
  branchIds: Types.ObjectId[];
  primaryBranchId?: Types.ObjectId;
  employmentType: "full_time" | "part_time" | "contractor" | "temporary";
  status: "invited" | "active" | "on_leave" | "inactive" | "terminated";
  isBookable: boolean;
  acceptsOnlineBookings: boolean;
  servesClientGender: "male" | "female" | "all";
  maxConcurrentClients: number;
  bio?: string;
  avatarUrl?: string;
  calendarColor: string;
  hireDate?: string;
  terminationDate?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeSchema = new Schema<IEmployee>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    employeeCode: { type: String, required: true, set: normalizeCode, minlength: 1, maxlength: 32 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 160 },
    title: { type: String, trim: true, maxlength: 100 },
    levelId: { type: Schema.Types.ObjectId, ref: "EmployeeLevel" },
    workEmail: { type: String, set: normalizeEmail, match: EMAIL_PATTERN, maxlength: 254 },
    workPhone: { type: String, set: normalizePhone, match: E164_PHONE_PATTERN },
    branchIds: [{ type: Schema.Types.ObjectId, ref: "Branch" }],
    primaryBranchId: { type: Schema.Types.ObjectId, ref: "Branch" },
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
    hireDate: {
      type: String,
      validate: { validator: isValidLocalDate, message: "Hire date must be YYYY-MM-DD" },
    },
    terminationDate: {
      type: String,
      validate: { validator: isValidLocalDate, message: "Termination date must be YYYY-MM-DD" },
    },
  },
  { timestamps: true, optimisticConcurrency: true },
);

EmployeeSchema.index({ employeeCode: 1 }, { unique: true });
EmployeeSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } },
);
EmployeeSchema.index({ branchIds: 1, status: 1, isBookable: 1 });
EmployeeSchema.index({ levelId: 1, status: 1 });

EmployeeSchema.pre("validate", function () {
  this.branchIds = [
    ...new Map((this.branchIds ?? []).map((id) => [id.toString(), id])).values(),
  ];

  if (this.primaryBranchId && !this.branchIds.some((id) => id.equals(this.primaryBranchId))) {
    this.invalidate("primaryBranchId", "Primary branch must be included in branchIds");
  }
  if (this.terminationDate && this.hireDate && this.terminationDate <= this.hireDate) {
    this.invalidate("terminationDate", "Termination date must be after hire date");
  }
  if (this.status === "active" && !this.userId) {
    this.invalidate("userId", "An active employee must have a local-login user account");
  }
  if (this.status === "active" && this.branchIds.length === 0) {
    this.invalidate("branchIds", "An active employee must be assigned to a branch");
  }
  if (this.status !== "active" && this.isBookable) {
    this.invalidate("isBookable", "Only active employees can be bookable");
  }
  if (this.acceptsOnlineBookings && !this.isBookable) {
    this.invalidate("acceptsOnlineBookings", "Online bookings require a bookable employee");
  }
});

const Employee = getOrCreateModel<IEmployee>("Employee", EmployeeSchema);

export { EmployeeSchema };
export default Employee;
