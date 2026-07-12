import { Schema, type Types } from "mongoose";

import { getOrCreateModel, isValidLocalDate } from "../core/shared.js";

export interface IBookingInquiry {
  customerId: Types.ObjectId;
  branchId?: Types.ObjectId;
  packageId?: Types.ObjectId;
  serviceIds: Types.ObjectId[];
  productIds: Types.ObjectId[];
  type: "service" | "product" | "package" | "wedding" | "event";
  preferredDateFrom?: string;
  preferredDateTo?: string;
  partySize: number;
  offsite: boolean;
  venueAddress?: string;
  customerNote?: string;
  internalNote?: string;
  status: "new" | "reviewing" | "quoted" | "accepted" | "declined" | "expired" | "cancelled";
  assignedToUserId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const BookingInquirySchema = new Schema<IBookingInquiry>(
  {
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch" },
    packageId: { type: Schema.Types.ObjectId, ref: "ServicePackage" },
    serviceIds: [{ type: Schema.Types.ObjectId, ref: "Service" }],
    productIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    type: { type: String, enum: ["service", "product", "package", "wedding", "event"], required: true },
    preferredDateFrom: {
      type: String,
      validate: { validator: isValidLocalDate, message: "Preferred date must be YYYY-MM-DD" },
    },
    preferredDateTo: {
      type: String,
      validate: { validator: isValidLocalDate, message: "Preferred date must be YYYY-MM-DD" },
    },
    partySize: { type: Number, default: 1, min: 1, max: 500 },
    offsite: { type: Boolean, default: false },
    venueAddress: { type: String, trim: true, maxlength: 1000 },
    customerNote: { type: String, trim: true, maxlength: 5000 },
    internalNote: { type: String, trim: true, maxlength: 5000, select: false },
    status: {
      type: String,
      enum: ["new", "reviewing", "quoted", "accepted", "declined", "expired", "cancelled"],
      default: "new",
    },
    assignedToUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, optimisticConcurrency: true },
);

BookingInquirySchema.index({ status: 1, createdAt: 1 });
BookingInquirySchema.index({ customerId: 1, createdAt: -1 });
BookingInquirySchema.index({ branchId: 1, preferredDateFrom: 1, status: 1 });

BookingInquirySchema.pre("validate", function () {
  this.serviceIds = [
    ...new Map((this.serviceIds ?? []).map((id) => [id.toString(), id])).values(),
  ];
  this.productIds = [
    ...new Map((this.productIds ?? []).map((id) => [id.toString(), id])).values(),
  ];
  if (!this.packageId && this.serviceIds.length === 0 && this.productIds.length === 0) {
    this.invalidate("serviceIds", "An inquiry needs a package, service, or product");
  }
  if (this.type !== "product" && !this.preferredDateFrom) {
    this.invalidate("preferredDateFrom", "Booking inquiries require a preferred date");
  }
  if (this.preferredDateTo && !this.preferredDateFrom) {
    this.invalidate("preferredDateFrom", "A preferred end date requires a start date");
  }
  if (this.preferredDateTo && this.preferredDateFrom && this.preferredDateTo < this.preferredDateFrom) {
    this.invalidate("preferredDateTo", "Preferred end date cannot precede the start date");
  }
  if (this.offsite && !this.venueAddress) {
    this.invalidate("venueAddress", "Off-site inquiries require a venue address");
  }
});

const BookingInquiry = getOrCreateModel<IBookingInquiry>(
  "BookingInquiry",
  BookingInquirySchema,
);

export { BookingInquirySchema };
export default BookingInquiry;
