import { beforeEach, describe, expect, it, vi } from "vitest";

const expiryMocks = vi.hoisted(() => ({
  holds: vi.fn(),
  quotes: vi.fn(),
  waitlist: vi.fn(),
}));

vi.mock("./booking.service.js", () => ({
  expireDueBookingHoldsForSystem: expiryMocks.holds,
}));
vi.mock("./inquiry.service.js", () => ({
  expireDueBookingQuotesForSystem: expiryMocks.quotes,
}));
vi.mock("./waitlist.service.js", () => ({
  expireDueWaitlistEntriesForSystem: expiryMocks.waitlist,
}));

import {
  expireDueBookingLifecycleRecords,
  processBookingLifecycleExpirations,
} from "./booking-lifecycle.service.js";

describe("booking lifecycle expiry runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expiryMocks.holds.mockResolvedValue({ expired: 0 });
    expiryMocks.quotes.mockResolvedValue({ expired: 0 });
    expiryMocks.waitlist.mockResolvedValue({ expired: 0 });
  });

  it("uses one cutoff and system worker identity across every domain", async () => {
    const now = new Date("2030-01-01T00:00:00.000Z");
    expiryMocks.holds.mockResolvedValue({ expired: 2 });
    expiryMocks.quotes.mockResolvedValue({ expired: 3 });
    expiryMocks.waitlist.mockResolvedValue({ expired: 4 });

    await expect(
      expireDueBookingLifecycleRecords({
        now,
        batchSize: 25,
        workerId: "worker-1",
      }),
    ).resolves.toEqual({
      pendingAdvanceHoldsExpired: 2,
      quotesExpired: 3,
      waitlistEntriesExpired: 4,
      totalExpired: 9,
    });

    const expected = { now, limit: 25, workerId: "worker-1" };
    expect(expiryMocks.holds).toHaveBeenCalledWith(expected);
    expect(expiryMocks.quotes).toHaveBeenCalledWith(expected);
    expect(expiryMocks.waitlist).toHaveBeenCalledWith(expected);
  });

  it("reports idle only when no conditional expiry won", async () => {
    await expect(processBookingLifecycleExpirations("worker-1")).resolves.toBe(
      "idle",
    );

    expiryMocks.quotes.mockResolvedValueOnce({ expired: 1 });
    await expect(processBookingLifecycleExpirations("worker-1")).resolves.toBe(
      "processed",
    );
  });

  it("rejects unsafe batch sizes before querying", async () => {
    await expect(
      expireDueBookingLifecycleRecords({ batchSize: 0 }),
    ).rejects.toThrow("batch size");
    expect(expiryMocks.holds).not.toHaveBeenCalled();
  });
});

