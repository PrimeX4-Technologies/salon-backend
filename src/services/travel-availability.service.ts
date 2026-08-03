import { Types } from "mongoose";

import type { ITimeInterval } from "../models/core/shared.js";
import BranchHours from "../models/scheduling/BranchHours.js";
import CalendarBlock from "../models/scheduling/CalendarBlock.js";
import CalendarReservation from "../models/scheduling/CalendarReservation.js";
import EmployeeSchedule from "../models/scheduling/EmployeeSchedule.js";
import TimeOff from "../models/scheduling/TimeOff.js";
import Employee from "../models/staff/Employee.js";
import { ApiError } from "../utils/ApiError.js";
import {
  everyRangeIsCovered,
  intersectRangeSets,
  rangesOverlap,
  subtractRanges,
  type MillisecondRange,
} from "../utils/availability.js";
import {
  addLocalDays,
  compareLocalDates,
  dateToSystemPlainDate,
  localDateTimeToDate,
  systemDayOfWeek,
} from "../utils/dateTime.js";
import type { EmployeeTravelBlock } from "./booking-allocation.service.js";

interface CheckTravelAvailabilityInput {
  branchId: string;
  blocks: readonly EmployeeTravelBlock[];
  excludeBookingId?: string;
  now: Date;
}

interface EffectiveDatedRecord {
  _id: Types.ObjectId;
  effectiveFrom: string;
  effectiveUntil?: string | null;
}

interface BranchHoursRecord extends EffectiveDatedRecord {
  days: Array<{
    dayOfWeek: number;
    isClosed: boolean;
    intervals: ITimeInterval[];
  }>;
}

interface EmployeeScheduleRecord extends EffectiveDatedRecord {
  employeeId: Types.ObjectId;
  days: Array<{
    dayOfWeek: number;
    shifts: ITimeInterval[];
    breaks: ITimeInterval[];
  }>;
}

const objectId = (value: string): Types.ObjectId => new Types.ObjectId(value);

const intervalsToRanges = (
  date: string,
  intervals: readonly ITimeInterval[],
): MillisecondRange[] =>
  intervals.map((interval) => ({
    start: localDateTimeToDate(date, interval.start).getTime(),
    end: localDateTimeToDate(date, interval.end).getTime(),
  }));

const applicableOn = (
  record: EffectiveDatedRecord,
  date: string,
): boolean =>
  record.effectiveFrom <= date &&
  (!record.effectiveUntil || record.effectiveUntil > date);

const latestEffective = <T extends EffectiveDatedRecord>(
  records: readonly T[],
  date: string,
): T | undefined =>
  records
    .filter((record) => applicableOn(record, date))
    .sort(
      (left, right) =>
        right.effectiveFrom.localeCompare(left.effectiveFrom) ||
        right._id.toString().localeCompare(left._id.toString()),
    )[0];

const datesCoveredByBlocks = (
  blocks: readonly EmployeeTravelBlock[],
): string[] => {
  const first = new Date(
    Math.min(...blocks.map((block) => block.startAt.getTime())),
  );
  const last = new Date(
    Math.max(
      ...blocks.map((block) =>
        Math.max(block.startAt.getTime(), block.endAt.getTime() - 1),
      ),
    ),
  );
  const lastDate = dateToSystemPlainDate(last);
  const dates: string[] = [];
  for (
    let date = dateToSystemPlainDate(first);
    compareLocalDates(date, lastDate) <= 0;
    date = addLocalDays(date, 1)
  ) {
    dates.push(date);
  }
  return dates;
};

const throwUnavailable = (
  block: EmployeeTravelBlock,
  reason:
    | "EMPLOYEE_NOT_ELIGIBLE"
    | "EMPLOYEE_NOT_SCHEDULED"
    | "BRANCH_BLOCKED"
    | "EMPLOYEE_UNAVAILABLE"
    | "EMPLOYEE_CAPACITY_REACHED"
    | "TRAVEL_START_IN_PAST",
): never => {
  throw ApiError.conflict(
    "An employee travel buffer is unavailable",
    {
      employeeId: block.employeeId,
      position: block.position,
      startAt: block.startAt,
      endAt: block.endAt,
      reason,
    },
    "BOOKING_TRAVEL_UNAVAILABLE",
  );
};

/**
 * Travel is exclusive employee time. It must fit the employee's effective
 * branch schedule and cannot overlap a branch closure, time off, a calendar
 * block, or another live employee reservation.
 */
export const assertEmployeeTravelAvailability = async (
  input: CheckTravelAvailabilityInput,
): Promise<void> => {
  if (input.blocks.length === 0) return;

  const employeeIds = [
    ...new Set(input.blocks.map((block) => block.employeeId)),
  ];
  const dates = datesCoveredByBlocks(input.blocks);
  const firstDate = dates[0];
  const lastDate = dates.at(-1);
  if (!firstDate || !lastDate) return;

  const rangeStart = new Date(
    Math.min(...input.blocks.map((block) => block.startAt.getTime())),
  );
  const rangeEnd = new Date(
    Math.max(...input.blocks.map((block) => block.endAt.getTime())),
  );
  const employeeObjectIds = employeeIds.map(objectId);
  const activeReservationFilter = {
    $or: [
      { status: "confirmed" as const },
      {
        status: "held" as const,
        holdExpiresAt: { $gt: input.now },
      },
    ],
    ...(input.excludeBookingId
      ? { bookingId: { $ne: objectId(input.excludeBookingId) } }
      : {}),
  };

  const [
    employees,
    branchHoursDocuments,
    scheduleDocuments,
    timeOff,
    calendarBlocks,
    reservations,
  ] = await Promise.all([
    Employee.find({
      _id: { $in: employeeObjectIds },
      branchIds: objectId(input.branchId),
      status: "active",
      isBookable: true,
    })
      .select("_id")
      .lean(),
    BranchHours.find({
      branchId: input.branchId,
      status: "active",
      effectiveFrom: { $lte: lastDate },
      $or: [
        { effectiveUntil: { $exists: false } },
        { effectiveUntil: null },
        { effectiveUntil: { $gt: firstDate } },
      ],
    })
      .select("effectiveFrom effectiveUntil days")
      .lean(),
    EmployeeSchedule.find({
      employeeId: { $in: employeeObjectIds },
      branchId: input.branchId,
      status: "active",
      effectiveFrom: { $lte: lastDate },
      $or: [
        { effectiveUntil: { $exists: false } },
        { effectiveUntil: null },
        { effectiveUntil: { $gt: firstDate } },
      ],
    })
      .select("employeeId effectiveFrom effectiveUntil days")
      .lean(),
    TimeOff.find({
      employeeId: { $in: employeeObjectIds },
      status: "approved",
      startAt: { $lt: rangeEnd },
      endAt: { $gt: rangeStart },
      $or: [
        { allBranches: true },
        { branchIds: objectId(input.branchId) },
      ],
    })
      .select("employeeId startAt endAt")
      .lean(),
    CalendarBlock.find({
      branchId: input.branchId,
      status: "active",
      blocksBookings: true,
      startAt: { $lt: rangeEnd },
      endAt: { $gt: rangeStart },
      $or: [
        { employeeId: { $exists: false } },
        { employeeId: null },
        { employeeId: { $in: employeeObjectIds } },
      ],
    })
      .select("employeeId startAt endAt")
      .lean(),
    CalendarReservation.find({
      branchId: input.branchId,
      resourceType: { $in: ["employee", "branch"] },
      startAt: { $lt: rangeEnd },
      endAt: { $gt: rangeStart },
      $and: [
        activeReservationFilter,
        {
          $or: [
            {
              resourceType: "employee",
              resourceId: { $in: employeeObjectIds },
            },
            {
              resourceType: "branch",
              resourceId: objectId(input.branchId),
            },
          ],
        },
      ],
    })
      .select("resourceType resourceId startAt endAt")
      .lean(),
  ]);

  const eligibleEmployees = new Set(
    employees.map((employee) => employee._id.toString()),
  );
  const branchHours =
    branchHoursDocuments as unknown as BranchHoursRecord[];
  const schedules =
    scheduleDocuments as unknown as EmployeeScheduleRecord[];

  const workingRangesByEmployee = new Map<string, MillisecondRange[]>();
  for (const employeeId of employeeIds) {
    const employeeSchedules = schedules.filter(
      (schedule) => schedule.employeeId.toString() === employeeId,
    );
    const ranges: MillisecondRange[] = [];
    for (const date of dates) {
      const hours = latestEffective(branchHours, date);
      const schedule = latestEffective(employeeSchedules, date);
      const dayOfWeek = systemDayOfWeek(date);
      const hoursDay = hours?.days.find(
        (day) => day.dayOfWeek === dayOfWeek,
      );
      const scheduleDay = schedule?.days.find(
        (day) => day.dayOfWeek === dayOfWeek,
      );
      if (!hoursDay || hoursDay.isClosed || !scheduleDay) continue;
      const branchRanges = intervalsToRanges(date, hoursDay.intervals);
      const shiftRanges = subtractRanges(
        intervalsToRanges(date, scheduleDay.shifts),
        intervalsToRanges(date, scheduleDay.breaks),
      );
      ranges.push(...intersectRangeSets(branchRanges, shiftRanges));
    }
    workingRangesByEmployee.set(employeeId, ranges);
  }

  for (const block of input.blocks) {
    const required = {
      start: block.startAt.getTime(),
      end: block.endAt.getTime(),
    };
    if (block.startAt < input.now) {
      throwUnavailable(block, "TRAVEL_START_IN_PAST");
    }
    if (!eligibleEmployees.has(block.employeeId)) {
      throwUnavailable(block, "EMPLOYEE_NOT_ELIGIBLE");
    }
    if (
      !everyRangeIsCovered(
        [required],
        workingRangesByEmployee.get(block.employeeId) ?? [],
      )
    ) {
      throwUnavailable(block, "EMPLOYEE_NOT_SCHEDULED");
    }
    if (
      calendarBlocks.some(
        (calendarBlock) =>
          !calendarBlock.employeeId &&
          rangesOverlap(required, {
            start: calendarBlock.startAt.getTime(),
            end: calendarBlock.endAt.getTime(),
          }),
      ) ||
      reservations.some(
        (reservation) =>
          reservation.resourceType === "branch" &&
          rangesOverlap(required, {
            start: reservation.startAt.getTime(),
            end: reservation.endAt.getTime(),
          }),
      )
    ) {
      throwUnavailable(block, "BRANCH_BLOCKED");
    }
    if (
      timeOff.some(
        (entry) =>
          entry.employeeId.equals(block.employeeId) &&
          rangesOverlap(required, {
            start: entry.startAt.getTime(),
            end: entry.endAt.getTime(),
          }),
      ) ||
      calendarBlocks.some(
        (calendarBlock) =>
          calendarBlock.employeeId?.equals(block.employeeId) &&
          rangesOverlap(required, {
            start: calendarBlock.startAt.getTime(),
            end: calendarBlock.endAt.getTime(),
          }),
      )
    ) {
      throwUnavailable(block, "EMPLOYEE_UNAVAILABLE");
    }
    if (
      reservations.some(
        (reservation) =>
          reservation.resourceType === "employee" &&
          reservation.resourceId.equals(block.employeeId) &&
          rangesOverlap(required, {
            start: reservation.startAt.getTime(),
            end: reservation.endAt.getTime(),
          }),
      )
    ) {
      throwUnavailable(block, "EMPLOYEE_CAPACITY_REACHED");
    }
  }
};
