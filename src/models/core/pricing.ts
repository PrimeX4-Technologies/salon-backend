import { Schema } from "mongoose";

import { CURRENCY_PATTERN, isNonNegativeInteger } from "./shared.js";

export const PRICE_MODES = ["fixed", "starting_from", "range", "quote_required"] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

export interface IPricePresentation {
  mode: PriceMode;
  currency: string;
  amountMinor?: number;
  fromAmountMinor?: number;
  toAmountMinor?: number;
  label?: string;
}

export const PricePresentationSchema = new Schema<IPricePresentation>(
  {
    mode: { type: String, enum: PRICE_MODES, required: true },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      match: CURRENCY_PATTERN,
      default: "LKR",
    },
    amountMinor: {
      type: Number,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must use integer minor units" },
    },
    fromAmountMinor: {
      type: Number,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must use integer minor units" },
    },
    toAmountMinor: {
      type: Number,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must use integer minor units" },
    },
    label: { type: String, trim: true, maxlength: 120 },
  },
  { _id: false },
);

PricePresentationSchema.pre("validate", function () {
  if (this.mode === "fixed") {
    this.fromAmountMinor = undefined;
    this.toAmountMinor = undefined;
    if (this.amountMinor === undefined) {
      this.invalidate("amountMinor", "A fixed price requires amountMinor");
    }
  }

  if (this.mode === "starting_from") {
    this.amountMinor = undefined;
    this.toAmountMinor = undefined;
    if (this.fromAmountMinor === undefined) {
      this.invalidate("fromAmountMinor", "A starting-from price requires fromAmountMinor");
    }
  }

  if (this.mode === "range") {
    this.amountMinor = undefined;
    if (this.fromAmountMinor === undefined || this.toAmountMinor === undefined) {
      this.invalidate("fromAmountMinor", "A price range requires both endpoints");
    } else if (this.toAmountMinor < this.fromAmountMinor) {
      this.invalidate("toAmountMinor", "Range maximum cannot be below its minimum");
    }
  }

  if (this.mode === "quote_required") {
    this.amountMinor = undefined;
    this.fromAmountMinor = undefined;
    this.toAmountMinor = undefined;
  }
});

export const ADVANCE_REQUIREMENTS = ["none", "optional", "required"] as const;
export type AdvanceRequirement = (typeof ADVANCE_REQUIREMENTS)[number];

export interface IAdvancePolicy {
  requirement: AdvanceRequirement;
  calculation: "none" | "fixed" | "percentage";
  fixedAmountMinor?: number;
  percentage?: number;
  basis: "estimate" | "accepted_quote";
}

export const AdvancePolicySchema = new Schema<IAdvancePolicy>(
  {
    requirement: { type: String, enum: ADVANCE_REQUIREMENTS, default: "none" },
    calculation: {
      type: String,
      enum: ["none", "fixed", "percentage"],
      default: "none",
    },
    fixedAmountMinor: {
      type: Number,
      min: 0,
      validate: { validator: isNonNegativeInteger, message: "Money must use integer minor units" },
    },
    percentage: { type: Number, min: 0, max: 100 },
    basis: { type: String, enum: ["estimate", "accepted_quote"], default: "estimate" },
  },
  { _id: false },
);

AdvancePolicySchema.pre("validate", function () {
  if (this.requirement === "none") {
    this.calculation = "none";
    this.fixedAmountMinor = undefined;
    this.percentage = undefined;
    return;
  }

  if (this.calculation === "none") {
    this.fixedAmountMinor = undefined;
    this.percentage = undefined;
    this.invalidate("calculation", "Optional or required advances need a calculation method");
  }

  if (this.calculation === "fixed") {
    this.percentage = undefined;
    if (this.fixedAmountMinor === undefined || this.fixedAmountMinor <= 0) {
      this.invalidate("fixedAmountMinor", "A fixed advance must be greater than zero");
    }
  }

  if (this.calculation === "percentage") {
    this.fixedAmountMinor = undefined;
    if (this.percentage === undefined || this.percentage <= 0) {
      this.invalidate("percentage", "An advance percentage must be greater than zero");
    }
  }
});
