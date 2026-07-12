import { Schema, type Types } from "mongoose";

import { ServiceDurationSchema, type IServiceDuration } from "../catalog/Service.js";
import { type IPricePresentation, PricePresentationSchema } from "../core/pricing.js";
import { getOrCreateModel, isValidLocalDate } from "../core/shared.js";

export interface IEmployeeService {
  branchId: Types.ObjectId;
  employeeId: Types.ObjectId;
  serviceId: Types.ObjectId;
  proficiency: "trainee" | "qualified" | "advanced" | "expert";
  priceOverride?: IPricePresentation;
  durationOverride?: IServiceDuration;
  servesClientGenderOverride?: "male" | "female" | "all";
  isActive: boolean;
  isOnlineBookable: boolean;
  validFrom?: string;
  validUntil?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EmployeeServiceSchema = new Schema<IEmployeeService>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true },
    proficiency: {
      type: String,
      enum: ["trainee", "qualified", "advanced", "expert"],
      default: "qualified",
    },
    priceOverride: PricePresentationSchema,
    durationOverride: ServiceDurationSchema,
    servesClientGenderOverride: { type: String, enum: ["male", "female", "all"] },
    isActive: { type: Boolean, default: true },
    isOnlineBookable: { type: Boolean, default: true },
    validFrom: {
      type: String,
      validate: { validator: isValidLocalDate, message: "Valid-from date must be YYYY-MM-DD" },
    },
    validUntil: {
      type: String,
      validate: { validator: isValidLocalDate, message: "Valid-until date must be YYYY-MM-DD" },
    },
  },
  { timestamps: true, optimisticConcurrency: true },
);

EmployeeServiceSchema.index(
  { branchId: 1, employeeId: 1, serviceId: 1 },
  { unique: true },
);
EmployeeServiceSchema.index({ branchId: 1, serviceId: 1, isActive: 1, isOnlineBookable: 1 });
EmployeeServiceSchema.index({ employeeId: 1, isActive: 1 });

EmployeeServiceSchema.pre("validate", function () {
  if (this.validUntil && this.validFrom && this.validUntil <= this.validFrom) {
    this.invalidate("validUntil", "Validity end must be after validity start");
  }
});

const EmployeeService = getOrCreateModel<IEmployeeService>("EmployeeService", EmployeeServiceSchema);

export { EmployeeServiceSchema };
export default EmployeeService;
