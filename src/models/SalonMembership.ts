import { Schema, type Types } from "mongoose";

import { getOrCreateModel } from "./shared.js";

export const SALON_PERMISSIONS = [
  "manage_salon",
  "manage_locations",
  "manage_staff",
  "manage_services",
  "manage_schedules",
  "manage_bookings",
  "view_customers",
  "manage_customers",
  "view_booking_payments",
  "manage_notifications",
  "manage_integrations",
  "manage_settings",
] as const;

export type SalonPermission = (typeof SALON_PERMISSIONS)[number];

export interface ISalonMembership {
  salonId: Types.ObjectId;
  userId: Types.ObjectId;
  role: "owner" | "admin" | "employee";
  permissions: SalonPermission[];
  allLocations: boolean;
  locationIds: Types.ObjectId[];
  requiredAuthMethod: "local";
  status: "invited" | "active" | "suspended" | "revoked";
  invitedByUserId?: Types.ObjectId;
  joinedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SalonMembershipSchema = new Schema<ISalonMembership>(
  {
    salonId: { type: Schema.Types.ObjectId, ref: "Salon", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["owner", "admin", "employee"], required: true },
    permissions: {
      type: [{ type: String, enum: SALON_PERMISSIONS }],
      default: [],
    },
    allLocations: { type: Boolean, default: true },
    locationIds: [{ type: Schema.Types.ObjectId, ref: "SalonLocation" }],
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

SalonMembershipSchema.index({ salonId: 1, userId: 1 }, { unique: true });
SalonMembershipSchema.index({ userId: 1, status: 1 });
SalonMembershipSchema.index({ salonId: 1, role: 1, status: 1 });

SalonMembershipSchema.pre("validate", function () {
  this.permissions = [...new Set(this.permissions ?? [])];
  this.locationIds = [
    ...new Map((this.locationIds ?? []).map((id) => [id.toString(), id])).values(),
  ];

  if (this.allLocations) {
    this.locationIds = [];
  }

  if (!this.allLocations && this.locationIds.length === 0) {
    this.invalidate("locationIds", "At least one location is required when allLocations is false");
  }
});

const SalonMembership = getOrCreateModel<ISalonMembership>(
  "SalonMembership",
  SalonMembershipSchema,
);

export { SalonMembershipSchema };
export default SalonMembership;
