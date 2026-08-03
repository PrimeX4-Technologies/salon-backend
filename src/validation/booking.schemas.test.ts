import { describe, expect, it } from "vitest";

import {
  createBookingBodySchema,
  createInquiryBodySchema,
  createQuoteBodySchema,
  waitlistListQuerySchema,
} from "./booking.schemas.js";

const id = "507f1f77bcf86cd799439011";
const secondId = "507f191e810c19729de860ea";

describe("booking API validation", () => {
  it("normalizes explicit-offset appointment timestamps", () => {
    const value = createBookingBodySchema.parse({
      branchId: id,
      items: [
        {
          serviceId: id,
          employeeId: secondId,
          startAt: "2099-01-01T10:00:00+05:30",
        },
      ],
    });

    expect(value.items[0]?.startAt).toBeInstanceOf(Date);
    expect(value.items[0]?.startAt.toISOString()).toBe(
      "2099-01-01T04:30:00.000Z",
    );
  });

  it("rejects caller-supplied snapshots and pricing", () => {
    const result = createBookingBodySchema.safeParse({
      branchId: id,
      items: [
        {
          serviceId: id,
          employeeId: secondId,
          startAt: "2099-01-01T10:00:00+05:30",
        },
      ],
      customerSnapshot: { name: "Forged customer" },
      pricingSnapshot: { displayAmountMinor: 1 },
    });

    expect(result.success).toBe(false);
  });

  it("requires meaningful inquiry content and off-site address", () => {
    expect(
      createInquiryBodySchema.safeParse({
        type: "wedding",
        preferredDateFrom: "2099-01-01",
        offsite: true,
      }).success,
    ).toBe(false);
  });

  it("accepts bounded travel buffers only for off-site bookings", () => {
    const base = {
      branchId: id,
      items: [
        {
          serviceId: id,
          employeeId: secondId,
          startAt: "2099-01-01T10:00:00+05:30",
        },
      ],
    };

    expect(
      createBookingBodySchema.safeParse({
        ...base,
        event: {
          type: "standard",
          partySize: 1,
          travelMinutesBefore: 30,
        },
      }).success,
    ).toBe(false);
    expect(
      createBookingBodySchema.safeParse({
        ...base,
        event: {
          type: "offsite",
          partySize: 2,
          offsiteAddress: "Colombo",
          travelMinutesBefore: 30,
          travelMinutesAfter: 45,
        },
      }).success,
    ).toBe(true);
  });

  it("requires a positive due amount for a required advance quote", () => {
    const result = createQuoteBodySchema.safeParse({
      branchId: id,
      validUntil: "2099-01-01T10:00:00Z",
      currency: "LKR",
      lines: [
        {
          type: "custom",
          name: "Wedding preparation",
          amountMinor: 100_000,
        },
      ],
      advanceRequirement: "required",
      advanceDueMinor: 0,
    });

    expect(result.success).toBe(false);
  });

  it("normalizes quote travel buffers for accepted off-site scheduling", () => {
    const value = createQuoteBodySchema.parse({
      branchId: id,
      validUntil: "2099-01-01T10:00:00Z",
      currency: "LKR",
      lines: [
        {
          type: "custom",
          name: "Wedding preparation",
          amountMinor: 100_000,
        },
      ],
      travelMinutesBefore: 30,
      travelMinutesAfter: 60,
    });

    expect(value.travelMinutesBefore).toBe(30);
    expect(value.travelMinutesAfter).toBe(60);
  });

  it("requires both fit-window endpoints", () => {
    expect(
      waitlistListQuerySchema.safeParse({
        fitsStartAt: "2099-01-01T10:00:00Z",
      }).success,
    ).toBe(false);
  });
});
