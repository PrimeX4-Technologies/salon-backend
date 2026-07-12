import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "../core/shared.js";

export interface ITimeOff {
  employeeId: Types.ObjectId;
  allBranches: boolean;
  branchIds: Types.ObjectId[];
  type: "vacation" | "sick" | "personal" | "unpaid" | "other";
  startAt: Date;
  endAt: Date;
  allDay: boolean;
  status: "requested" | "approved" | "rejected" | "cancelled";
  reason?: string;
  privateNote?: string;
  requestedByUserId?: Types.ObjectId;
  decidedByUserId?: Types.ObjectId;
  decidedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TimeOffSchema = new Schema<ITimeOff>(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    allBranches: { type: Boolean, default: true },
    branchIds: [{ type: Schema.Types.ObjectId, ref: "Branch" }],
    type: {
      type: String,
      enum: ["vacation", "sick", "personal", "unpaid", "other"],
      required: true,
    },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    allDay: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["requested", "approved", "rejected", "cancelled"],
      default: "requested",
    },
    reason: { type: String, trim: true, maxlength: 500 },
    privateNote: { type: String, trim: true, maxlength: 2000, select: false },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);

TimeOffSchema.index({ employeeId: 1, status: 1, startAt: 1, endAt: 1 });
TimeOffSchema.index({ branchIds: 1, status: 1, startAt: 1 });

TimeOffSchema.pre("validate", function () {
  this.branchIds = [
    ...new Map((this.branchIds ?? []).map((id) => [id.toString(), id])).values(),
  ];
  if (this.allBranches) this.branchIds = [];
  if (!this.allBranches && this.branchIds.length === 0) {
    this.invalidate("branchIds", "Select a branch or enable allBranches");
  }
  if (this.endAt <= this.startAt) this.invalidate("endAt", "Time off must end after it starts");
  if (["approved", "rejected"].includes(this.status) && (!this.decidedByUserId || !this.decidedAt)) {
    this.invalidate("decidedByUserId", "A decision actor and timestamp are required");
  }
});

const TimeOff = getOrCreateModel<ITimeOff>("TimeOff", TimeOffSchema);

export { TimeOffSchema };
export default TimeOff;
