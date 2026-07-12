import { Schema, type Types } from "mongoose";

import type { PriceMode } from "../core/pricing.js";
import { CURRENCY_PATTERN, getOrCreateModel, isNonNegativeInteger } from "../core/shared.js";
import { BOOKING_STATUSES, type BookingStatus } from "./Booking.js";

interface IBookedPhase {
  key: string;
  type: "application" | "processing" | "finishing" | "buffer" | "travel";
  startAt: Date;
  endAt: Date;
  blocksEmployee: boolean;
  blocksBranch: boolean;
}

interface IServiceSnapshot {
  serviceId: Types.ObjectId;
  code: string;
  name: string;
  targetClientGender: "male" | "female" | "all";
}

interface IEmployeeSnapshot {
  employeeId: Types.ObjectId;
  name: string;
  title?: string;
}

interface IItemPriceSnapshot {
  mode: PriceMode;
  currency: string;
  listedAmountMinor?: number;
  listedFromMinor?: number;
  listedToMinor?: number;
  estimatedAmountMinor?: number;
  quotedAmountMinor?: number;
}

export interface IBookingItem {
  branchId: Types.ObjectId;
  bookingId: Types.ObjectId;
  quoteLineId?: Types.ObjectId;
  packageId?: Types.ObjectId;
  sequence: number;
  serviceId: Types.ObjectId;
  employeeId: Types.ObjectId;
  serviceSnapshot: IServiceSnapshot;
  employeeSnapshot: IEmployeeSnapshot;
  phases: IBookedPhase[];
  startAt: Date;
  endAt: Date;
  priceSnapshot: IItemPriceSnapshot;
  status: BookingStatus;
  createdAt: Date;
  updatedAt: Date;
}

const BookedPhaseSchema = new Schema<IBookedPhase>(
  {
    key: { type: String, required: true, trim: true, maxlength: 80 },
    type: {
      type: String,
      enum: ["application", "processing", "finishing", "buffer", "travel"],
      required: true,
    },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    blocksEmployee: { type: Boolean, required: true },
    blocksBranch: { type: Boolean, default: false },
  },
  { _id: false },
);

const ServiceSnapshotSchema = new Schema<IServiceSnapshot>(
  {
    serviceId: { type: Schema.Types.ObjectId, required: true },
    code: { type: String, required: true, trim: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    targetClientGender: { type: String, enum: ["male", "female", "all"], required: true },
  },
  { _id: false },
);

const EmployeeSnapshotSchema = new Schema<IEmployeeSnapshot>(
  {
    employeeId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    title: { type: String, trim: true, maxlength: 100 },
  },
  { _id: false },
);

const optionalMoneyField = {
  type: Number,
  min: 0,
  validate: { validator: isNonNegativeInteger, message: "Money must use integer minor units" },
} as const;

const ItemPriceSnapshotSchema = new Schema<IItemPriceSnapshot>(
  {
    mode: {
      type: String,
      enum: ["fixed", "starting_from", "range", "quote_required"],
      required: true,
    },
    currency: { type: String, required: true, uppercase: true, match: CURRENCY_PATTERN },
    listedAmountMinor: optionalMoneyField,
    listedFromMinor: optionalMoneyField,
    listedToMinor: optionalMoneyField,
    estimatedAmountMinor: optionalMoneyField,
    quotedAmountMinor: optionalMoneyField,
  },
  { _id: false },
);

const BookingItemSchema = new Schema<IBookingItem>(
  {
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true },
    quoteLineId: Schema.Types.ObjectId,
    packageId: { type: Schema.Types.ObjectId, ref: "ServicePackage" },
    sequence: { type: Number, required: true, min: 0 },
    serviceId: { type: Schema.Types.ObjectId, ref: "Service", required: true },
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", required: true },
    serviceSnapshot: { type: ServiceSnapshotSchema, required: true },
    employeeSnapshot: { type: EmployeeSnapshotSchema, required: true },
    phases: { type: [BookedPhaseSchema], required: true },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    priceSnapshot: { type: ItemPriceSnapshotSchema, required: true },
    status: { type: String, enum: BOOKING_STATUSES, required: true },
  },
  { timestamps: true, optimisticConcurrency: true },
);

BookingItemSchema.index({ bookingId: 1, sequence: 1 }, { unique: true });
BookingItemSchema.index({ branchId: 1, employeeId: 1, status: 1, startAt: 1, endAt: 1 });
BookingItemSchema.index({ serviceId: 1, startAt: -1 });

BookingItemSchema.pre("validate", function () {
  if (this.endAt <= this.startAt) this.invalidate("endAt", "Booking item must end after it starts");
  this.phases = this.phases ?? [];
  if (this.phases.length === 0) {
    this.invalidate("phases", "At least one scheduled phase is required");
    return;
  }
  if (!this.serviceId || !this.employeeId || !this.serviceSnapshot || !this.employeeSnapshot) {
    if (!this.serviceSnapshot) this.invalidate("serviceSnapshot", "Service snapshot is required");
    if (!this.employeeSnapshot) this.invalidate("employeeSnapshot", "Employee snapshot is required");
    return;
  }
  if (!this.priceSnapshot) {
    this.invalidate("priceSnapshot", "Price snapshot is required");
    return;
  }
  const price = this.priceSnapshot;
  if (price.mode === "fixed" && price.listedAmountMinor === undefined) {
    this.invalidate("priceSnapshot.listedAmountMinor", "Fixed pricing requires its listed amount");
  }
  if (price.mode === "fixed") {
    price.listedFromMinor = undefined;
    price.listedToMinor = undefined;
  } else if (price.mode === "starting_from") {
    price.listedAmountMinor = undefined;
    price.listedToMinor = undefined;
  } else if (price.mode === "range") {
    price.listedAmountMinor = undefined;
  } else {
    price.listedAmountMinor = undefined;
    price.listedFromMinor = undefined;
    price.listedToMinor = undefined;
  }
  if (price.mode === "starting_from" && price.listedFromMinor === undefined) {
    this.invalidate("priceSnapshot.listedFromMinor", "Starting-from pricing requires its minimum");
  }
  if (price.mode === "range") {
    if (price.listedFromMinor === undefined || price.listedToMinor === undefined) {
      this.invalidate("priceSnapshot.listedToMinor", "Range pricing requires both listed bounds");
    } else if (price.listedToMinor < price.listedFromMinor) {
      this.invalidate("priceSnapshot.listedToMinor", "Listed maximum cannot be below minimum");
    }
  }
  if (price.mode === "quote_required" && price.quotedAmountMinor === undefined) {
    this.invalidate("priceSnapshot.quotedAmountMinor", "Quote-required items need a quoted amount");
  }
  if (!this.serviceId.equals(this.serviceSnapshot.serviceId)) {
    this.invalidate("serviceSnapshot.serviceId", "Service snapshot must match serviceId");
  }
  if (!this.employeeId.equals(this.employeeSnapshot.employeeId)) {
    this.invalidate("employeeSnapshot.employeeId", "Employee snapshot must match employeeId");
  }

  const phaseKeys = this.phases.map((phase) => phase.key);
  if (new Set(phaseKeys).size !== phaseKeys.length) {
    this.invalidate("phases", "Phase keys must be unique within a booking item");
  }
  const sorted = [...this.phases].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  sorted.forEach((phase, index) => {
    if (phase.endAt <= phase.startAt) this.invalidate("phases", `Phase ${phase.key} must end after it starts`);
    const previous = sorted[index - 1];
    if (previous && previous.endAt > phase.startAt) {
      this.invalidate("phases", "Service phases cannot overlap");
    }
    if (phase.startAt < this.startAt || phase.endAt > this.endAt) {
      this.invalidate("phases", `Phase ${phase.key} must be within the item range`);
    }
  });
});

const BookingItem = getOrCreateModel<IBookingItem>("BookingItem", BookingItemSchema);

export { BookingItemSchema };
export default BookingItem;
