import { Types } from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface LeanQuery {
  select: (fields: string) => {
    lean: () => Promise<unknown>;
  };
}

type Find = (filter: unknown) => LeanQuery;

const modelMocks = vi.hoisted(() => ({
  employeeFind: vi.fn<Find>(),
  branchHoursFind: vi.fn<Find>(),
  employeeScheduleFind: vi.fn<Find>(),
  timeOffFind: vi.fn<Find>(),
  calendarBlockFind: vi.fn<Find>(),
  reservationFind: vi.fn<Find>(),
}));

vi.mock("../models/staff/Employee.js", () => ({
  default: { find: modelMocks.employeeFind },
}));
vi.mock("../models/scheduling/BranchHours.js", () => ({
  default: { find: modelMocks.branchHoursFind },
}));
vi.mock("../models/scheduling/EmployeeSchedule.js", () => ({
  default: { find: modelMocks.employeeScheduleFind },
}));
vi.mock("../models/scheduling/TimeOff.js", () => ({
  default: { find: modelMocks.timeOffFind },
}));
vi.mock("../models/scheduling/CalendarBlock.js", () => ({
  default: { find: modelMocks.calendarBlockFind },
}));
vi.mock("../models/scheduling/CalendarReservation.js", () => ({
  default: { find: modelMocks.reservationFind },
}));

import type { EmployeeTravelBlock } from "./booking-allocation.service.js";
import { assertEmployeeTravelAvailability } from "./travel-availability.service.js";

const query = (value: unknown): LeanQuery => ({
  select: () => ({
    lean: () => Promise.resolve(value),
  }),
});

const sevenDays = Array.from({ length: 7 }, (_, dayOfWeek) => ({
  dayOfWeek,
  isClosed: false,
  intervals: [{ start: "08:00", end: "18:00" }],
}));

describe("employee travel availability", () => {
  const branchId = new Types.ObjectId();
  const employeeId = new Types.ObjectId();
  const block: EmployeeTravelBlock = {
    employeeId: employeeId.toString(),
    itemIndex: 0,
    position: "before",
    phaseKey: `travel:before:${employeeId.toString()}`,
    startAt: new Date("2099-01-01T03:30:00.000Z"),
    endAt: new Date("2099-01-01T04:00:00.000Z"),
    reservationUnits: 5,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.employeeFind.mockReturnValue(query([{ _id: employeeId }]));
    modelMocks.branchHoursFind.mockReturnValue(
      query([
        {
          _id: new Types.ObjectId(),
          effectiveFrom: "2090-01-01",
          days: sevenDays,
        },
      ]),
    );
    modelMocks.employeeScheduleFind.mockReturnValue(
      query([
        {
          _id: new Types.ObjectId(),
          employeeId,
          effectiveFrom: "2090-01-01",
          days: sevenDays.map(({ dayOfWeek }) => ({
            dayOfWeek,
            shifts: [{ start: "08:00", end: "18:00" }],
            breaks: [],
          })),
        },
      ]),
    );
    modelMocks.timeOffFind.mockReturnValue(query([]));
    modelMocks.calendarBlockFind.mockReturnValue(query([]));
    modelMocks.reservationFind.mockReturnValue(query([]));
  });

  it("accepts travel covered by effective branch and employee schedules", async () => {
    await expect(
      assertEmployeeTravelAvailability({
        branchId: branchId.toString(),
        blocks: [block],
        now: new Date("2098-12-31T00:00:00.000Z"),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects travel that overlaps another live employee reservation", async () => {
    modelMocks.reservationFind.mockReturnValue(
      query([
        {
          resourceType: "employee",
          resourceId: employeeId,
          startAt: new Date("2099-01-01T03:45:00.000Z"),
          endAt: new Date("2099-01-01T04:15:00.000Z"),
        },
      ]),
    );

    await expect(
      assertEmployeeTravelAvailability({
        branchId: branchId.toString(),
        blocks: [block],
        now: new Date("2098-12-31T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "BOOKING_TRAVEL_UNAVAILABLE",
      details: {
        reason: "EMPLOYEE_CAPACITY_REACHED",
      },
    });
  });
});
