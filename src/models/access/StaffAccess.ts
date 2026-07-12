import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "../core/shared.js";

export const STAFF_PERMISSIONS = [
  "manage_business",
  "manage_branches",
  "manage_staff",
  "manage_catalog",
  "manage_schedules",
  "manage_bookings",
  "view_customers",
  "manage_customers",
  "view_booking_payments",
  "manage_notifications",
  "manage_integrations",
  "manage_settings",
] as const;

export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];

export interface IStaffAccess {
  userId: Types.ObjectId;
  permissions: StaffPermission[];
  allBranches: boolean;
  branchIds: Types.ObjectId[];
  requiredAuthMethod: "local";
  status: "invited" | "active" | "suspended" | "revoked";
  invitedByUserId?: Types.ObjectId;
  joinedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const StaffAccessSchema = new Schema<IStaffAccess>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    permissions: { type: [{ type: String, enum: STAFF_PERMISSIONS }], default: [] },
    allBranches: { type: Boolean, default: true },
    branchIds: [{ type: Schema.Types.ObjectId, ref: "Branch" }],
    requiredAuthMethod: { type: String, enum: ["local"], default: "local", immutable: true },
    status: {
      type: String,
      enum: ["invited", "active", "suspended", "revoked"],
      default: "invited",
    },
    invitedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    joinedAt: Date,
  },
  { timestamps: true, optimisticConcurrency: true },
);

StaffAccessSchema.index({ userId: 1 }, { unique: true });
StaffAccessSchema.index({ status: 1, updatedAt: -1 });
StaffAccessSchema.index({ branchIds: 1, status: 1 });

StaffAccessSchema.pre("validate", function () {
  this.permissions = [...new Set(this.permissions ?? [])];
  this.branchIds = [
    ...new Map((this.branchIds ?? []).map((id) => [id.toString(), id])).values(),
  ];

  if (this.allBranches) this.branchIds = [];
  if (!this.allBranches && this.branchIds.length === 0) {
    this.invalidate("branchIds", "At least one branch is required when allBranches is false");
  }
});

const StaffAccess = getOrCreateModel<IStaffAccess>("StaffAccess", StaffAccessSchema);

export { StaffAccessSchema };
export default StaffAccess;
