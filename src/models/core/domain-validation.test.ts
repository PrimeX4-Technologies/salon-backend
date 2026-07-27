import { Types } from "mongoose";
import { describe, expect, it } from "vitest";

import User from "../auth/User.js";
import BranchHours from "../scheduling/BranchHours.js";
import Service from "../catalog/Service.js";

describe("domain model validation", () => {
  it("prevents Google authentication for staff accounts", async () => {
    const user = new User({
      name: "Staff Member",
      email: "staff@example.com",
      googleId: "google-subject",
      role: "employee",
      authMethods: ["google"],
    });

    await expect(user.validate()).rejects.toMatchObject({
      name: "ValidationError",
    });
  });

  it("requires all seven weekdays in a branch-hours version", async () => {
    const hours = new BranchHours({
      branchId: new Types.ObjectId(),
      name: "Incomplete week",
      effectiveFrom: "2026-07-26",
      days: [
        {
          dayOfWeek: 0,
          isClosed: false,
          intervals: [{ start: "09:00", end: "18:00" }],
        },
      ],
    });

    await expect(hours.validate()).rejects.toMatchObject({
      name: "ValidationError",
    });
  });

  it("validates flexible starting-from prices and service duration", async () => {
    const service = new Service({
      categoryId: new Types.ObjectId(),
      code: "KERATIN",
      name: "Keratin Treatment",
      slug: "keratin-treatment",
      duration: {
        applicationMinutes: 60,
        processingMinutes: 45,
        finishingMinutes: 30,
        bufferMinutes: 15,
        processingBlocksEmployee: false,
      },
      price: {
        mode: "starting_from",
        currency: "LKR",
        fromAmountMinor: 300_000,
      },
    });

    await expect(service.validate()).resolves.toBeUndefined();
  });
});
