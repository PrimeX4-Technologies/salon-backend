import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "../core/shared.js";

export interface IWaitlistEntry {
  branchId: Types.ObjectId;
  customerId: Types.ObjectId;
  serviceIds: Types.ObjectId[];
  preferredEmployeeIds: Types.ObjectId[];
  windowStartAt: Date;
  windowEndAt: Date;
  requiredMinutes: number;
  partySize: number;
  priority: number;
  source: "online" | "admin" | "walk_in";
  status: "waiting" | "offered" | "booked" | "expired" | "cancelled";
  offeredUntil?: Date;
  bookingId?: Types.ObjectId;
  note?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WaitlistEntrySchema = new Schema<IWaitlistEntry>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true },
    serviceIds: [{ type: Schema.Types.ObjectId, ref: "Service", required: true }],
    preferredEmployeeIds: [{ type: Schema.Types.ObjectId, ref: "Employee" }],
    windowStartAt: { type: Date, required: true },
    windowEndAt: { type: Date, required: true },
    requiredMinutes: { type: Number, required: true, min: 1, max: 2880 },
    partySize: { type: Number, default: 1, min: 1, max: 500 },
    priority: { type: Number, default: 0, min: -100, max: 100 },
    source: { type: String, enum: ["online", "admin", "walk_in"], required: true },
    status: {
      type: String,
      enum: ["waiting", "offered", "booked", "expired", "cancelled"],
      default: "waiting",
    },
    offeredUntil: Date,
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking" },
    note: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true, optimisticConcurrency: true },
);

WaitlistEntrySchema.index({ branchId: 1, status: 1, windowStartAt: 1, priority: -1 });
WaitlistEntrySchema.index({ customerId: 1, status: 1 });
WaitlistEntrySchema.index({ status: 1, offeredUntil: 1 });

WaitlistEntrySchema.pre("validate", function () {
  this.serviceIds = [
    ...new Map((this.serviceIds ?? []).map((id) => [id.toString(), id])).values(),
  ];
  this.preferredEmployeeIds = [
    ...new Map((this.preferredEmployeeIds ?? []).map((id) => [id.toString(), id])).values(),
  ];
  if (this.serviceIds.length === 0) this.invalidate("serviceIds", "At least one service is required");
  if (this.windowEndAt <= this.windowStartAt) {
    this.invalidate("windowEndAt", "Waitlist window must end after it starts");
  }
  if (this.status === "offered" && !this.offeredUntil) {
    this.invalidate("offeredUntil", "An offered waitlist entry requires an expiry");
  }
  if (this.status === "booked" && !this.bookingId) {
    this.invalidate("bookingId", "A booked waitlist entry requires a booking");
  }
});

const WaitlistEntry = getOrCreateModel<IWaitlistEntry>("WaitlistEntry", WaitlistEntrySchema);

export { WaitlistEntrySchema };
export default WaitlistEntry;
