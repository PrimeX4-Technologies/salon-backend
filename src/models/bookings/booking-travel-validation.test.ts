import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import Booking from "./Booking.js";
import BookingItem from "./BookingItem.js";

describe("booking travel model validation", () => {
  it("allows travel phases outside the service item while preventing overlap", async () => {
    const branchId = new Types.ObjectId();
    const bookingId = new Types.ObjectId();
    const serviceId = new Types.ObjectId();
    const employeeId = new Types.ObjectId();
    const startAt = new Date("2099-01-01T04:00:00.000Z");
    const endAt = new Date("2099-01-01T05:00:00.000Z");
    const base = {
      branchId,
      bookingId,
      sequence: 0,
      serviceId,
      employeeId,
      serviceSnapshot: {
        serviceId,
        code: "BRIDAL",
        name: "Bridal service",
        targetClientGender: "all",
      },
      employeeSnapshot: {
        employeeId,
        name: "Stylist",
      },
      startAt,
      endAt,
      priceSnapshot: {
        mode: "fixed",
        currency: "LKR",
        listedAmountMinor: 100_000,
        estimatedAmountMinor: 100_000,
      },
      status: "confirmed",
    } as const;
    const item = new BookingItem({
      ...base,
      phases: [
        {
          key: `travel:before:${employeeId.toString()}`,
          type: "travel",
          startAt: new Date("2099-01-01T03:30:00.000Z"),
          endAt: startAt,
          blocksEmployee: true,
          blocksBranch: false,
        },
        {
          key: "application",
          type: "application",
          startAt,
          endAt,
          blocksEmployee: true,
          blocksBranch: false,
        },
      ],
    });

    await expect(item.validate()).resolves.toBeUndefined();

    item.phases[0].endAt = new Date("2099-01-01T04:15:00.000Z");
    await expect(item.validate()).rejects.toMatchObject({
      name: "ValidationError",
    });
  });

  it("rejects travel buffers on non-off-site bookings", async () => {
    const booking = new Booking({
      branchId: new Types.ObjectId(),
      customerId: new Types.ObjectId(),
      employeeIds: [new Types.ObjectId()],
      source: "admin",
      status: "confirmed",
      startAt: new Date("2099-01-01T04:00:00.000Z"),
      endAt: new Date("2099-01-01T05:00:00.000Z"),
      customerSnapshot: { name: "Customer" },
      pricingSnapshot: {
        mode: "fixed",
        currency: "LKR",
        displayAmountMinor: 100_000,
        estimatedSubtotalMinor: 100_000,
        advanceRequirement: "none",
        advanceDueMinor: 0,
        advancePaidMinor: 0,
      },
      externalSettlement: { status: "not_tracked" },
      reservationCountSnapshot: 1,
      cancellationPolicySnapshot: { cancellationWindowHours: 24 },
      event: {
        type: "standard",
        partySize: 1,
        travelMinutesBefore: 30,
        travelMinutesAfter: 0,
      },
    });

    await expect(booking.validate()).rejects.toMatchObject({
      name: "ValidationError",
    });
  });
});
