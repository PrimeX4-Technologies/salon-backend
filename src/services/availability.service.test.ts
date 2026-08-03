import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import type { IPricePresentation } from "../models/core/pricing.js";
import { resolveAvailabilityPrice } from "./availability.service.js";

const fixedPrice = (amountMinor: number): IPricePresentation => ({
  mode: "fixed",
  currency: "LKR",
  amountMinor,
});

describe("availability price precedence", () => {
  it("uses employee override, then employee-level tier, then branch override, then base", () => {
    const assignedLevelId = new Types.ObjectId();
    const otherLevelId = new Types.ObjectId();
    const employeePriceOverride = fixedPrice(6_000);
    const tierPrice = fixedPrice(5_000);
    const branchPriceOverride = fixedPrice(4_000);
    const basePrice = fixedPrice(3_000);
    const sharedInput = {
      employeeLevelId: assignedLevelId,
      tierPrices: [
        { employeeLevelId: assignedLevelId, price: tierPrice },
      ],
      branchPriceOverride,
      basePrice,
    };

    expect(
      resolveAvailabilityPrice({
        ...sharedInput,
        employeePriceOverride,
      }),
    ).toBe(employeePriceOverride);
    expect(resolveAvailabilityPrice(sharedInput)).toBe(tierPrice);
    expect(
      resolveAvailabilityPrice({
        ...sharedInput,
        employeeLevelId: otherLevelId,
      }),
    ).toBe(branchPriceOverride);
    expect(
      resolveAvailabilityPrice({
        ...sharedInput,
        employeeLevelId: otherLevelId,
        branchPriceOverride: undefined,
      }),
    ).toBe(basePrice);
  });
});
