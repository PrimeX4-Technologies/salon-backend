import { describe, expect, it } from "vitest";

import {
  canAllocateCapacity,
  enumerateAlignedStarts,
  everyRangeIsCovered,
  intersectRangeSets,
  subtractRanges,
} from "./availability.js";

describe("availability interval helpers", () => {
  it("intersects opening hours with an employee shift", () => {
    expect(
      intersectRangeSets(
        [{ start: 9, end: 18 }],
        [{ start: 8, end: 12 }, { start: 13, end: 17 }],
      ),
    ).toEqual([{ start: 9, end: 12 }, { start: 13, end: 17 }]);
  });

  it("subtracts breaks without losing the surrounding shift", () => {
    expect(
      subtractRanges(
        [{ start: 9, end: 17 }],
        [{ start: 12, end: 13 }, { start: 15, end: 15.5 }],
      ),
    ).toEqual([
      { start: 9, end: 12 },
      { start: 13, end: 15 },
      { start: 15.5, end: 17 },
    ]);
  });

  it("requires every blocking service phase to fit an available interval", () => {
    expect(
      everyRangeIsCovered(
        [{ start: 9, end: 10 }, { start: 11, end: 12 }],
        [{ start: 8, end: 10 }, { start: 11, end: 13 }],
      ),
    ).toBe(true);
    expect(
      everyRangeIsCovered(
        [{ start: 9, end: 10.5 }],
        [{ start: 8, end: 10 }],
      ),
    ).toBe(false);
  });

  it("allows back-to-back reservations and rejects excess concurrency", () => {
    const existing = [
      { start: 9, end: 10, units: 1 },
      { start: 10, end: 11, units: 1 },
    ];
    expect(
      canAllocateCapacity(existing, [{ start: 9, end: 11, units: 1 }], 2),
    ).toBe(true);
    expect(
      canAllocateCapacity(existing, [{ start: 9.5, end: 10.5, units: 1 }], 1),
    ).toBe(false);
  });

  it("aligns candidates to the business slot grid", () => {
    expect(
      enumerateAlignedStarts(
        [{ start: 8 * 60 + 7, end: 9 * 60 }],
        0,
        15,
        30,
      ),
    ).toEqual([8 * 60 + 15, 8 * 60 + 30]);
  });
});
