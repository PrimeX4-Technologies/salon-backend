import { Schema, type Types } from "mongoose";

import type { IServiceDuration } from "./Service.js";
import { getOrCreateModel, isNonNegativeInteger } from "./shared.js";

export interface IEmployeeService {
  salonId: Types.ObjectId;
  locationId: Types.ObjectId;
  employeeId: Types.ObjectId;
  serviceId: Types.ObjectId;
  proficiency: "trainee" | "qualified" | "advanced" | "expert";
  priceOverrideMinor?: number;
  durationOverride?: IServiceDuration;
  servesClientGenderOverride?: "male" | "female" | "all";
  isActive: boolean;
  isOnlineBookable: boolean;
  validFrom?: Date;
  validUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DurationOverrideSchema = new Schema<IServiceDuration>(
  {
    applicationMinutes: { type: Number, required: true, min: 0, max: 1440 },
    processingMinutes: { type: Number, default: 0, min: 0, max: 1440 },
    finishingMinutes: { type: Number, default: 0, min: 0, max: 1440 },
    bufferMinutes: { type: Number, default: 0, min: 0, max: 240 },
    processingBlocksEmployee: { type: Boolean, default: true },
  },
  { _id: false },
);

const EmployeeServiceSchema = new Schema<IEmployeeService>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    locationId: { type: Schema.Types.ObjectId, ref: "SalonLocation", required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true },
    proficiency: {
      type: String,
      enum: ["trainee", "qualified", "advanced", "expert"],
      default: "qualified",
    },
    priceOverrideMinor: {
      type: Number,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Price must be integer minor units" },
    },
    durationOverride: DurationOverrideSchema,
    servesClientGenderOverride: { type: String, enum: ["male", "female", "all"] },
    isActive: { type: Boolean, default: true },
    isOnlineBookable: { type: Boolean, default: true },
    validFrom: Date,
    validUntil: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);

EmployeeServiceSchema.index(
  { salonId: 1, locationId: 1, employeeId: 1, serviceId: 1 },
  { unique: true },
);
EmployeeServiceSchema.index({ salonId: 1, locationId: 1, serviceId: 1, isActive: 1 });
EmployeeServiceSchema.index({ salonId: 1, employeeId: 1, isActive: 1 });

EmployeeServiceSchema.pre("validate", function () {
  if (this.validUntil && this.validFrom && this.validUntil <= this.validFrom) {
    this.invalidate("validUntil", "Validity end must be later than validity start");
  }
});

const EmployeeService = getOrCreateModel<IEmployeeService>("EmployeeService", EmployeeServiceSchema);

export { EmployeeServiceSchema };
export default EmployeeService;
