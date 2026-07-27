import { Types, type ClientSession, type QueryFilter } from "mongoose";

import type {
  BookableResourceListQuery,
  CalendarBlockListQuery,
  CreateBookableResourceBody,
  CreateCalendarBlockBody,
  CreateEmployeeScheduleBody,
  CreateTimeOffBody,
  MyTimeOffListQuery,
  ScheduleListQuery,
  StaffTimeOffListQuery,
  TimeOffDecisionBody,
  UpdateBookableResourceBody,
  UpdateCalendarBlockBody,
  UpdateEmployeeScheduleBody,
} from "../validation/scheduling.schemas.js";
import Branch from "../models/business/Branch.js";
import BranchService from "../models/catalog/BranchService.js";
import Service from "../models/catalog/Service.js";
import BookableResource, {
  type IBookableResource,
} from "../models/scheduling/BookableResource.js";
import CalendarBlock, {
  type ICalendarBlock,
} from "../models/scheduling/CalendarBlock.js";
import CalendarReservation from "../models/scheduling/CalendarReservation.js";
import EmployeeSchedule, {
  type IEmployeeSchedule,
} from "../models/scheduling/EmployeeSchedule.js";
import TimeOff, { type ITimeOff } from "../models/scheduling/TimeOff.js";
import Employee from "../models/staff/Employee.js";
import { ApiError } from "../utils/ApiError.js";
import {
  addLocalDays,
  compareLocalDates,
  dateToSystemPlainDate,
  localDateTimeToDate,
} from "../utils/dateTime.js";
import { withTransaction } from "../utils/database.js";
import {
  buildPaginationMeta,
  escapeRegExp,
  parsePagination,
} from "../utils/pagination.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";
import {
  withBookingConfigReadLease,
  withBookingConfigReadLeases,
  withBookingConfigWriteLease,
} from "./booking-config-lock.service.js";
import {
  type DistributedLockGuard,
  withRenewableDistributedLocks,
} from "./distributed-lock.service.js";

export interface SchedulingStaffScope {
  allBranches: boolean;
  branchIds: string[];
}

const objectId = (value: string): Types.ObjectId => new Types.ObjectId(value);
const MAX_TIME_OFF_MS = 366 * 24 * 60 * 60 * 1_000;
const TIME_OFF_LOCK_TTL_MS = 30_000;

const requireBranchInScope = (
  scope: SchedulingStaffScope,
  branchId: string,
): void => {
  if (!scope.allBranches && !scope.branchIds.includes(branchId)) {
    throw ApiError.forbidden(
      "You do not have access to this branch",
      "BRANCH_ACCESS_FORBIDDEN",
    );
  }
};

const requireBranchesInScope = (
  scope: SchedulingStaffScope,
  branchIds: readonly Types.ObjectId[],
): void => {
  if (scope.allBranches) return;
  const forbidden = branchIds.find(
    (branchId) => !scope.branchIds.includes(branchId.toString()),
  );
  if (forbidden) {
    throw ApiError.forbidden(
      "This operation affects a branch outside your access scope",
      "BRANCH_ACCESS_FORBIDDEN",
    );
  }
};

const runWithLock = async <T>(
  key: string,
  ttlMs: number,
  operation: (guard: DistributedLockGuard) => Promise<T>,
): Promise<T> => runWithLocks([key], ttlMs, operation);

const runWithLocks = async <T>(
  keys: string[],
  ttlMs: number,
  operation: (guard: DistributedLockGuard) => Promise<T>,
): Promise<T> =>
  withRenewableDistributedLocks(keys, ttlMs, operation, {
    contentionMessage:
      "Another scheduling change is in progress; retry shortly",
    contentionCode: "SCHEDULING_WRITE_IN_PROGRESS",
    unavailableMessage:
      "Scheduling locking is temporarily unavailable; retry shortly",
    unavailableCode: "SCHEDULING_LOCK_UNAVAILABLE",
    lostMessage:
      "Scheduling lock ownership was lost; verify the change before retrying",
    lostCode: "SCHEDULING_LOCK_LOST",
    logContext: { subsystem: "scheduling" },
  });

const combineLockGuards = (
  ...guards: readonly DistributedLockGuard[]
): DistributedLockGuard => ({
  assertValid: async (): Promise<void> => {
    await Promise.all(guards.map((guard) => guard.assertValid()));
  },
});

const listAllBookingConfigBranchIds = async (): Promise<Types.ObjectId[]> =>
  (await Branch.distinct("_id", {})) as Types.ObjectId[];

const bookingConfigBranchIdsForTimeOff = async (
  timeOff: Pick<ITimeOff, "allBranches" | "branchIds">,
): Promise<Types.ObjectId[]> =>
  timeOff.allBranches
    ? listAllBookingConfigBranchIds()
    : timeOff.branchIds;

const intervalLockDates = (startAt: Date, endAt: Date): string[] => {
  if (endAt <= startAt) return [];
  const firstDate = dateToSystemPlainDate(startAt);
  const finalDate = dateToSystemPlainDate(
    new Date(endAt.getTime() - 1),
  );
  const dates: string[] = [];
  for (
    let date = firstDate;
    compareLocalDates(date, finalDate) <= 0;
    date = addLocalDays(date, 1)
  ) {
    dates.push(date);
  }
  return dates;
};

const bookingIntervalLockKeys = (
  branchIds: readonly Types.ObjectId[] | readonly string[],
  employeeId: Types.ObjectId | string | undefined,
  startAt: Date,
  endAt: Date,
): string[] => {
  const dates = intervalLockDates(startAt, endAt);
  return [
    ...branchIds.flatMap((branchId) =>
      dates.map(
        (date) => `booking:branch:${branchId.toString()}:${date}`,
      ),
    ),
    ...(employeeId
      ? dates.map(
          (date) => `booking:employee:${employeeId.toString()}:${date}`,
        )
      : []),
  ];
};

const requireBranch = async (
  branchId: string,
  session?: ClientSession,
) => {
  const branch = await Branch.findById(branchId).session(session ?? null);
  if (!branch) {
    throw ApiError.notFound("Branch was not found", "BRANCH_NOT_FOUND");
  }
  return branch;
};

const requireEmployee = async (
  employeeId: string,
  session?: ClientSession,
) => {
  const employee = await Employee.findById(employeeId).session(session ?? null);
  if (!employee) {
    throw ApiError.notFound("Employee was not found", "EMPLOYEE_NOT_FOUND");
  }
  return employee;
};

const requireEmployeeAtBranch = async (
  employeeId: string,
  branchId: string,
  session?: ClientSession,
) => {
  const [branch, employee] = await Promise.all([
    requireBranch(branchId, session),
    requireEmployee(employeeId, session),
  ]);
  if (!employee.branchIds.some((id) => id.equals(branch._id))) {
    throw ApiError.conflict(
      "Employee is not assigned to this branch",
      undefined,
      "EMPLOYEE_BRANCH_MISMATCH",
    );
  }
  return employee;
};

const assertNoActiveScheduleOverlap = async (
  schedule: Pick<
    IEmployeeSchedule,
    "branchId" | "employeeId" | "effectiveFrom" | "effectiveUntil" | "status"
  >,
  excludingId?: string,
  session?: ClientSession,
): Promise<void> => {
  if (schedule.status !== "active") return;

  const filter: QueryFilter<IEmployeeSchedule> = {
    branchId: schedule.branchId,
    employeeId: schedule.employeeId,
    status: "active",
    effectiveFrom: { $lt: schedule.effectiveUntil ?? "9999-12-31" },
    $or: [
      { effectiveUntil: { $exists: false } },
      { effectiveUntil: null },
      { effectiveUntil: { $gt: schedule.effectiveFrom } },
    ],
  };
  if (excludingId) filter._id = { $ne: objectId(excludingId) };

  if (await EmployeeSchedule.exists(filter).session(session ?? null)) {
    throw ApiError.conflict(
      "Active employee-schedule date ranges cannot overlap",
      undefined,
      "EMPLOYEE_SCHEDULE_OVERLAP",
    );
  }
};

const getScheduleDocument = async (
  branchId: string,
  employeeId: string,
  scheduleId: string,
  session?: ClientSession,
) => {
  const schedule = await EmployeeSchedule.findOne({
    _id: scheduleId,
    branchId,
    employeeId,
  }).session(session ?? null);
  if (!schedule) {
    throw ApiError.notFound(
      "Employee schedule was not found",
      "EMPLOYEE_SCHEDULE_NOT_FOUND",
    );
  }
  return schedule;
};

export const listEmployeeSchedules = async (
  branchId: string,
  employeeId: string,
  query: ScheduleListQuery,
) => {
  await requireEmployeeAtBranch(employeeId, branchId);
  const pagination = parsePagination(query);
  const filter: QueryFilter<IEmployeeSchedule> = {
    branchId: objectId(branchId),
    employeeId: objectId(employeeId),
  };
  if (query.status) filter.status = query.status;
  if (query.effectiveOn) {
    filter.effectiveFrom = { $lte: query.effectiveOn };
    filter.$or = [
      { effectiveUntil: { $exists: false } },
      { effectiveUntil: null },
      { effectiveUntil: { $gt: query.effectiveOn } },
    ];
  }

  const [items, total] = await Promise.all([
    EmployeeSchedule.find(filter)
      .select("-__v")
      .sort({ effectiveFrom: -1, createdAt: -1, _id: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    EmployeeSchedule.countDocuments(filter),
  ]);
  return {
    items,
    pagination: buildPaginationMeta(total, pagination),
  };
};

export const getEmployeeSchedule = async (
  branchId: string,
  employeeId: string,
  scheduleId: string,
) => {
  await requireEmployeeAtBranch(employeeId, branchId);
  const schedule = await EmployeeSchedule.findOne({
    _id: scheduleId,
    branchId,
    employeeId,
  })
    .select("-__v")
    .lean();
  if (!schedule) {
    throw ApiError.notFound(
      "Employee schedule was not found",
      "EMPLOYEE_SCHEDULE_NOT_FOUND",
    );
  }
  return schedule;
};

export const createEmployeeSchedule = async (
  branchId: string,
  employeeId: string,
  input: CreateEmployeeScheduleBody,
  context: AuditActorContext,
) =>
  withBookingConfigWriteLease(branchId, async () => {
    const scheduleId = await withTransaction(async (session) => {
      await requireEmployeeAtBranch(employeeId, branchId, session);
      const schedule = new EmployeeSchedule({
        branchId: objectId(branchId),
        employeeId: objectId(employeeId),
        ...input,
        effectiveUntil: input.effectiveUntil ?? undefined,
      });
      await assertNoActiveScheduleOverlap(schedule, undefined, session);
      await schedule.save({ session });
      await recordAudit(
        {
          context,
          action: "employee_schedule.created",
          entityType: "EmployeeSchedule",
          entityId: schedule._id,
          changes: {
            branchId,
            employeeId,
            status: schedule.status,
            effectiveFrom: schedule.effectiveFrom,
            effectiveUntil: schedule.effectiveUntil,
          },
        },
        session,
      );
      return schedule._id;
    });
    return getEmployeeSchedule(branchId, employeeId, scheduleId.toString());
  });

export const updateEmployeeSchedule = async (
  branchId: string,
  employeeId: string,
  scheduleId: string,
  input: UpdateEmployeeScheduleBody,
  context: AuditActorContext,
) =>
  withBookingConfigWriteLease(branchId, async () => {
    await withTransaction(async (session) => {
      await requireEmployeeAtBranch(employeeId, branchId, session);
      const schedule = await getScheduleDocument(
        branchId,
        employeeId,
        scheduleId,
        session,
      );
      if (schedule.status === "archived") {
        throw ApiError.conflict(
          "Archived employee schedules cannot be changed",
          undefined,
          "EMPLOYEE_SCHEDULE_ARCHIVED",
        );
      }
      schedule.set({
        ...input,
        ...(input.effectiveUntil !== undefined
          ? { effectiveUntil: input.effectiveUntil ?? undefined }
          : {}),
      });
      await assertNoActiveScheduleOverlap(schedule, scheduleId, session);
      await schedule.save({ session });
      await recordAudit(
        {
          context,
          action: "employee_schedule.updated",
          entityType: "EmployeeSchedule",
          entityId: schedule._id,
          changes: { changedFields: Object.keys(input) },
        },
        session,
      );
    });
    return getEmployeeSchedule(branchId, employeeId, scheduleId);
  });

export const archiveEmployeeSchedule = async (
  branchId: string,
  employeeId: string,
  scheduleId: string,
  context: AuditActorContext,
) =>
  withBookingConfigWriteLease(branchId, async () => {
    await withTransaction(async (session) => {
      const schedule = await getScheduleDocument(
        branchId,
        employeeId,
        scheduleId,
        session,
      );
      if (schedule.status === "archived") return;
      schedule.status = "archived";
      await schedule.save({ session });
      await recordAudit(
        {
          context,
          action: "employee_schedule.archived",
          entityType: "EmployeeSchedule",
          entityId: schedule._id,
        },
        session,
      );
    });
    return getEmployeeSchedule(branchId, employeeId, scheduleId);
  });

const requireEmployeeForUser = async (
  userId: string,
  session?: ClientSession,
) => {
  const employee = await Employee.findOne({ userId }).session(session ?? null);
  if (!employee) {
    throw ApiError.notFound(
      "Employee profile was not found",
      "EMPLOYEE_PROFILE_NOT_FOUND",
    );
  }
  return employee;
};

const assertTimeOffDuration = (startAt: Date, endAt: Date): void => {
  if (endAt.getTime() - startAt.getTime() > MAX_TIME_OFF_MS) {
    throw ApiError.badRequest(
      "A single time-off request cannot exceed 366 days",
      undefined,
      "TIME_OFF_TOO_LONG",
    );
  }
};

const assertAllDayBoundaries = (
  allDay: boolean,
  startAt: Date,
  endAt: Date,
): void => {
  if (!allDay) return;
  const normalizedStart = localDateTimeToDate(
    dateToSystemPlainDate(startAt),
    "00:00",
  );
  const normalizedEnd = localDateTimeToDate(
    dateToSystemPlainDate(endAt),
    "00:00",
  );
  if (
    startAt.getTime() !== normalizedStart.getTime() ||
    endAt.getTime() !== normalizedEnd.getTime()
  ) {
    throw ApiError.badRequest(
      "All-day ranges must start and end at midnight in the system time zone",
      undefined,
      "INVALID_ALL_DAY_BOUNDARY",
    );
  }
};

const assertNoTimeOffOverlap = async (
  employeeId: Types.ObjectId,
  startAt: Date,
  endAt: Date,
  session?: ClientSession,
): Promise<void> => {
  const overlapping = await TimeOff.exists({
    employeeId,
    status: { $in: ["requested", "approved"] },
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  }).session(session ?? null);
  if (overlapping) {
    throw ApiError.conflict(
      "This request overlaps existing requested or approved time off",
      undefined,
      "TIME_OFF_OVERLAP",
    );
  }
};

const timeRangeFilter = (
  from?: Date,
  to?: Date,
): Pick<QueryFilter<ITimeOff>, "startAt" | "endAt"> => ({
  ...(to ? { startAt: { $lt: to } } : {}),
  ...(from ? { endAt: { $gt: from } } : {}),
});

export const listMyTimeOff = async (
  userId: string,
  query: MyTimeOffListQuery,
) => {
  const employee = await requireEmployeeForUser(userId);
  const pagination = parsePagination(query);
  const filter: QueryFilter<ITimeOff> = {
    employeeId: employee._id,
    ...timeRangeFilter(query.from, query.to),
  };
  if (query.status) filter.status = query.status;

  const [items, total] = await Promise.all([
    TimeOff.find(filter)
      .select("-privateNote -decidedByUserId -__v")
      .sort({ startAt: -1, _id: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    TimeOff.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, pagination) };
};

export const requestMyTimeOff = async (
  userId: string,
  input: CreateTimeOffBody,
  context: AuditActorContext,
) => {
  assertTimeOffDuration(input.startAt, input.endAt);
  assertAllDayBoundaries(input.allDay, input.startAt, input.endAt);
  const employee = await requireEmployeeForUser(userId);
  const configBranchIds = input.allBranches
    ? await listAllBookingConfigBranchIds()
    : input.branchIds;

  return withBookingConfigReadLeases(
    configBranchIds,
    async (configGuard) =>
      runWithLock(
        `employee-time-off:${employee._id.toString()}`,
        TIME_OFF_LOCK_TTL_MS,
        async (lockGuard) => {
          const guard = combineLockGuards(configGuard, lockGuard);
          const timeOffId = await withTransaction(async (session) => {
            const currentEmployee = await requireEmployeeForUser(
              userId,
              session,
            );
            const requestedBranchIds = input.allBranches
              ? []
              : [...new Set(input.branchIds)];
            const assignedBranchIds = new Set(
              currentEmployee.branchIds.map((id) => id.toString()),
            );
            if (
              requestedBranchIds.some((id) => !assignedBranchIds.has(id))
            ) {
              throw ApiError.forbidden(
                "Time off can only target your assigned branches",
                "TIME_OFF_BRANCH_FORBIDDEN",
              );
            }
            await assertNoTimeOffOverlap(
              currentEmployee._id,
              input.startAt,
              input.endAt,
              session,
            );

            const timeOff = new TimeOff({
              employeeId: currentEmployee._id,
              allBranches: input.allBranches,
              branchIds: requestedBranchIds.map(objectId),
              type: input.type,
              startAt: input.startAt,
              endAt: input.endAt,
              allDay: input.allDay,
              status: "requested",
              reason: input.reason,
              requestedByUserId: objectId(userId),
            });
            await timeOff.save({ session });
            await recordAudit(
              {
                context,
                action: "time_off.requested",
                entityType: "TimeOff",
                entityId: timeOff._id,
                changes: {
                  employeeId: currentEmployee._id.toString(),
                  startAt: timeOff.startAt,
                  endAt: timeOff.endAt,
                },
              },
              session,
            );
            await guard.assertValid();
            return timeOff._id;
          });
          return TimeOff.findById(timeOffId)
            .select("-privateNote -decidedByUserId -__v")
            .lean();
        },
      ),
  );
};

export const cancelMyTimeOff = async (
  userId: string,
  timeOffId: string,
  context: AuditActorContext,
) => {
  const employee = await requireEmployeeForUser(userId);
  const initial = await TimeOff.findOne({
    _id: timeOffId,
    employeeId: employee._id,
  }).select("allBranches branchIds");
  if (!initial) {
    throw ApiError.notFound("Time off was not found", "TIME_OFF_NOT_FOUND");
  }
  const configBranchIds = await bookingConfigBranchIdsForTimeOff(initial);

  return withBookingConfigReadLeases(
    configBranchIds,
    async (configGuard) =>
      runWithLock(
        `employee-time-off:${employee._id.toString()}`,
        TIME_OFF_LOCK_TTL_MS,
        async (lockGuard) => {
          const guard = combineLockGuards(configGuard, lockGuard);
          await withTransaction(async (session) => {
            const timeOff = await TimeOff.findOne({
              _id: timeOffId,
              employeeId: employee._id,
            }).session(session);
            if (!timeOff) {
              throw ApiError.notFound(
                "Time off was not found",
                "TIME_OFF_NOT_FOUND",
              );
            }
            if (timeOff.status === "cancelled") return;
            if (timeOff.status === "rejected") {
              throw ApiError.conflict(
                "Rejected time off cannot be cancelled",
                undefined,
                "INVALID_TIME_OFF_TRANSITION",
              );
            }
            timeOff.status = "cancelled";
            await timeOff.save({ session });
            await recordAudit(
              {
                context,
                action: "time_off.cancelled_by_employee",
                entityType: "TimeOff",
                entityId: timeOff._id,
              },
              session,
            );
            await guard.assertValid();
          });
          return TimeOff.findById(timeOffId)
            .select("-privateNote -decidedByUserId -__v")
            .lean();
        },
      ),
  );
};

const assertTimeOffScope = async (
  timeOff: Pick<ITimeOff, "allBranches" | "branchIds" | "employeeId">,
  scope: SchedulingStaffScope,
  session?: ClientSession,
): Promise<void> => {
  if (scope.allBranches) return;
  let affectedBranches = timeOff.branchIds;
  if (timeOff.allBranches) {
    const employee = await Employee.findById(timeOff.employeeId)
      .select("branchIds")
      .session(session ?? null);
    if (!employee) {
      throw ApiError.notFound("Employee was not found", "EMPLOYEE_NOT_FOUND");
    }
    affectedBranches = employee.branchIds;
  }
  requireBranchesInScope(scope, affectedBranches);
};

export const listStaffTimeOff = async (
  query: StaffTimeOffListQuery,
  scope: SchedulingStaffScope,
) => {
  if (query.branchId) requireBranchInScope(scope, query.branchId);
  const pagination = parsePagination(query);
  const filter: QueryFilter<ITimeOff> = {
    ...timeRangeFilter(query.from, query.to),
  };
  if (query.employeeId) filter.employeeId = objectId(query.employeeId);
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;

  const relevantBranches = query.branchId
    ? [objectId(query.branchId)]
    : scope.allBranches
      ? undefined
      : scope.branchIds.map(objectId);
  if (relevantBranches) {
    const employeesAtRelevantBranches = await Employee.find({
      branchIds: { $in: relevantBranches },
    })
      .select("_id")
      .lean();
    filter.$or = [
      {
        allBranches: true,
        employeeId: {
          $in: employeesAtRelevantBranches.map((employee) => employee._id),
        },
      },
      {
        allBranches: false,
        branchIds: { $in: relevantBranches },
      },
    ];
  }

  const [items, total] = await Promise.all([
    TimeOff.find(filter)
      .select("+privateNote -__v")
      .populate({ path: "employeeId", select: "name employeeCode branchIds status" })
      .sort({ startAt: 1, _id: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    TimeOff.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, pagination) };
};

const decideTimeOff = async (
  timeOffId: string,
  targetStatus: "approved" | "rejected" | "cancelled",
  input: TimeOffDecisionBody,
  context: AuditActorContext,
  scope: SchedulingStaffScope,
) => {
  const initial = await TimeOff.findById(timeOffId).select(
    "employeeId allBranches branchIds startAt endAt",
  );
  if (!initial) {
    throw ApiError.notFound("Time off was not found", "TIME_OFF_NOT_FOUND");
  }
  const configBranchIds = await bookingConfigBranchIdsForTimeOff(initial);

  return withBookingConfigReadLeases(
    configBranchIds,
    async (configGuard) => {
      const affectedBranchIds = initial.allBranches
        ? (
            await Employee.findById(initial.employeeId)
              .select("branchIds")
              .lean()
          )?.branchIds ?? []
        : initial.branchIds;

      return runWithLocks(
        [
          `employee-time-off:${initial.employeeId.toString()}`,
          ...bookingIntervalLockKeys(
            affectedBranchIds,
            initial.employeeId,
            initial.startAt,
            initial.endAt,
          ),
        ],
        TIME_OFF_LOCK_TTL_MS,
        async (lockGuard) => {
          const guard = combineLockGuards(configGuard, lockGuard);
          await withTransaction(async (session) => {
            const timeOff = await TimeOff.findById(timeOffId)
              .select("+privateNote")
              .session(session);
            if (!timeOff) {
              throw ApiError.notFound(
                "Time off was not found",
                "TIME_OFF_NOT_FOUND",
              );
            }
            await assertTimeOffScope(timeOff, scope, session);

            if (timeOff.status === targetStatus) return;
            const allowedCurrent =
              targetStatus === "cancelled"
                ? new Set<ITimeOff["status"]>(["requested", "approved"])
                : new Set<ITimeOff["status"]>(["requested"]);
            if (!allowedCurrent.has(timeOff.status)) {
              throw ApiError.conflict(
                `Time off in ${timeOff.status} state cannot be changed to ${targetStatus}`,
                undefined,
                "INVALID_TIME_OFF_TRANSITION",
              );
            }

            if (targetStatus === "approved") {
              const reservationConflict = await CalendarReservation.exists({
                resourceType: "employee",
                resourceId: timeOff.employeeId,
                ...(!timeOff.allBranches
                  ? { branchId: { $in: timeOff.branchIds } }
                  : {}),
                startAt: { $lt: timeOff.endAt },
                endAt: { $gt: timeOff.startAt },
                $or: [
                  { status: "confirmed" },
                  { status: "held", holdExpiresAt: { $gt: new Date() } },
                ],
              }).session(session);
              if (reservationConflict) {
                throw ApiError.conflict(
                  "Time off overlaps an existing booking reservation",
                  undefined,
                  "TIME_OFF_BOOKING_CONFLICT",
                );
              }
            }

            timeOff.status = targetStatus;
            if (input.privateNote !== undefined) {
              timeOff.privateNote = input.privateNote;
            }
            if (targetStatus !== "cancelled") {
              timeOff.decidedAt = new Date();
              timeOff.decidedByUserId = context.actorUserId
                ? new Types.ObjectId(context.actorUserId.toString())
                : undefined;
            }
            await timeOff.save({ session });
            await recordAudit(
              {
                context,
                action: `time_off.${targetStatus}`,
                entityType: "TimeOff",
                entityId: timeOff._id,
              },
              session,
            );
            await guard.assertValid();
          });

          return TimeOff.findById(timeOffId)
            .select("+privateNote -__v")
            .lean();
        },
      );
    },
  );
};

export const approveTimeOff = (
  timeOffId: string,
  input: TimeOffDecisionBody,
  context: AuditActorContext,
  scope: SchedulingStaffScope,
) => decideTimeOff(timeOffId, "approved", input, context, scope);

export const rejectTimeOff = (
  timeOffId: string,
  input: TimeOffDecisionBody,
  context: AuditActorContext,
  scope: SchedulingStaffScope,
) => decideTimeOff(timeOffId, "rejected", input, context, scope);

export const cancelStaffTimeOff = (
  timeOffId: string,
  input: TimeOffDecisionBody,
  context: AuditActorContext,
  scope: SchedulingStaffScope,
) => decideTimeOff(timeOffId, "cancelled", input, context, scope);

const getCalendarBlockDocument = async (
  branchId: string,
  blockId: string,
  session?: ClientSession,
) => {
  const block = await CalendarBlock.findOne({
    _id: blockId,
    branchId,
    source: "manual",
  })
    .select("+note")
    .session(session ?? null);
  if (!block) {
    throw ApiError.notFound(
      "Manual calendar block was not found",
      "CALENDAR_BLOCK_NOT_FOUND",
    );
  }
  return block;
};

const validateCalendarBlockEmployee = async (
  branchId: string,
  employeeId: string | null | undefined,
  session?: ClientSession,
): Promise<void> => {
  await requireBranch(branchId, session);
  if (employeeId) {
    await requireEmployeeAtBranch(employeeId, branchId, session);
  }
};

const assertNoCalendarBlockBookingConflict = async (
  branchId: string,
  employeeId: string | null | undefined,
  startAt: Date,
  endAt: Date,
  session: ClientSession,
): Promise<void> => {
  const conflict = await CalendarReservation.exists({
    branchId,
    ...(employeeId
      ? {
          resourceType: "employee",
          resourceId: objectId(employeeId),
        }
      : {}),
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
    $or: [
      { status: "confirmed" },
      { status: "held", holdExpiresAt: { $gt: new Date() } },
    ],
  }).session(session);
  if (conflict) {
    throw ApiError.conflict(
      "Calendar block overlaps an existing booking reservation",
      undefined,
      "CALENDAR_BLOCK_BOOKING_CONFLICT",
    );
  }
};

const runWithCalendarBlockMutationLocks = async <T>(
  branchId: string,
  blockId: string,
  input: UpdateCalendarBlockBody | undefined,
  operation: (guard: DistributedLockGuard) => Promise<T>,
): Promise<T> =>
  withBookingConfigReadLease(branchId, async (configGuard) =>
    runWithLock(`calendar-block:${blockId}`, 30_000, async (blockGuard) => {
      const current = await getCalendarBlockDocument(branchId, blockId);
      const resultingEmployeeId =
        input?.employeeId !== undefined
          ? input.employeeId ?? undefined
          : current.employeeId;
      const resultingStartAt = input?.startAt ?? current.startAt;
      const resultingEndAt = input?.endAt ?? current.endAt;
      const resultingBlocksBookings =
        input?.blocksBookings ?? current.blocksBookings;
      const lockKeys = new Set<string>();
      if (current.blocksBookings) {
        bookingIntervalLockKeys(
          [current.branchId],
          current.employeeId,
          current.startAt,
          current.endAt,
        ).forEach((key) => lockKeys.add(key));
      }
      if (resultingBlocksBookings) {
        bookingIntervalLockKeys(
          [current.branchId],
          resultingEmployeeId,
          resultingStartAt,
          resultingEndAt,
        ).forEach((key) => lockKeys.add(key));
      }
      return runWithLocks([...lockKeys], 30_000, (intervalGuard) =>
        operation(
          combineLockGuards(configGuard, blockGuard, intervalGuard),
        ),
      );
    }),
  );

export const listCalendarBlocks = async (
  branchId: string,
  query: CalendarBlockListQuery,
) => {
  await requireBranch(branchId);
  const pagination = parsePagination(query);
  const filter: QueryFilter<ICalendarBlock> = { branchId: objectId(branchId) };
  if (query.activeOnly) filter.status = "active";
  if (query.blocksBookings !== undefined) {
    filter.blocksBookings = query.blocksBookings;
  }
  if (query.employeeId) {
    filter.$or = [
      { employeeId: objectId(query.employeeId) },
      { employeeId: { $exists: false } },
      { employeeId: null },
    ];
  }
  if (query.to) filter.startAt = { $lt: query.to };
  if (query.from) filter.endAt = { $gt: query.from };

  const [items, total] = await Promise.all([
    CalendarBlock.find(filter)
      .select("+note -__v")
      .populate({ path: "employeeId", select: "name employeeCode" })
      .sort({ startAt: 1, _id: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    CalendarBlock.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, pagination) };
};

export const getCalendarBlock = async (
  branchId: string,
  blockId: string,
) => {
  await requireBranch(branchId);
  const block = await CalendarBlock.findOne({ _id: blockId, branchId })
    .select("+note -__v")
    .populate({ path: "employeeId", select: "name employeeCode" })
    .lean();
  if (!block) {
    throw ApiError.notFound("Calendar block was not found", "CALENDAR_BLOCK_NOT_FOUND");
  }
  return block;
};

export const createCalendarBlock = async (
  branchId: string,
  input: CreateCalendarBlockBody,
  context: AuditActorContext,
) =>
  withBookingConfigReadLease(branchId, async (configGuard) =>
    runWithLocks(
      input.blocksBookings
        ? bookingIntervalLockKeys(
            [branchId],
            input.employeeId ?? undefined,
            input.startAt,
            input.endAt,
          )
        : [],
      30_000,
      async (lockGuard) => {
        const guard = combineLockGuards(configGuard, lockGuard);
        const blockId = await withTransaction(async (session) => {
          await validateCalendarBlockEmployee(
            branchId,
            input.employeeId,
            session,
          );
          assertAllDayBoundaries(input.allDay, input.startAt, input.endAt);
          if (input.blocksBookings) {
            await assertNoCalendarBlockBookingConflict(
              branchId,
              input.employeeId,
              input.startAt,
              input.endAt,
              session,
            );
          }
          const block = new CalendarBlock({
            branchId: objectId(branchId),
            employeeId: input.employeeId
              ? objectId(input.employeeId)
              : undefined,
            type: input.type,
            source: "manual",
            title: input.title,
            note: input.note ?? undefined,
            startAt: input.startAt,
            endAt: input.endAt,
            allDay: input.allDay,
            blocksBookings: input.blocksBookings,
            status: "active",
            createdByUserId: context.actorUserId
              ? new Types.ObjectId(context.actorUserId.toString())
              : undefined,
          });
          await block.save({ session });
          await recordAudit(
            {
              context,
              action: "calendar_block.created",
              entityType: "CalendarBlock",
              entityId: block._id,
              changes: {
                branchId,
                employeeId: input.employeeId,
                startAt: block.startAt,
                endAt: block.endAt,
              },
            },
            session,
          );
          await guard.assertValid();
          return block._id;
        });
        return getCalendarBlock(branchId, blockId.toString());
      },
    ),
  );

export const updateCalendarBlock = (
  branchId: string,
  blockId: string,
  input: UpdateCalendarBlockBody,
  context: AuditActorContext,
) =>
  runWithCalendarBlockMutationLocks(branchId, blockId, input, async (guard) => {
    await withTransaction(async (session) => {
      const block = await getCalendarBlockDocument(branchId, blockId, session);
      if (block.status === "cancelled") {
        throw ApiError.conflict(
          "Cancelled calendar blocks cannot be changed",
          undefined,
          "CALENDAR_BLOCK_CANCELLED",
        );
      }
      const resultingEmployeeId =
        input.employeeId !== undefined
          ? input.employeeId
          : block.employeeId?.toString();
      await validateCalendarBlockEmployee(branchId, resultingEmployeeId, session);
      block.set({
        ...input,
        ...(input.employeeId !== undefined
          ? { employeeId: input.employeeId ? objectId(input.employeeId) : undefined }
          : {}),
        ...(input.note !== undefined ? { note: input.note ?? undefined } : {}),
      });
      assertAllDayBoundaries(block.allDay, block.startAt, block.endAt);
      if (block.blocksBookings) {
        await assertNoCalendarBlockBookingConflict(
          branchId,
          block.employeeId?.toString(),
          block.startAt,
          block.endAt,
          session,
        );
      }
      await block.save({ session });
      await recordAudit(
        {
          context,
          action: "calendar_block.updated",
          entityType: "CalendarBlock",
          entityId: block._id,
          changes: { changedFields: Object.keys(input) },
        },
        session,
      );
      await guard.assertValid();
    });
    return getCalendarBlock(branchId, blockId);
  });

export const cancelCalendarBlock = (
  branchId: string,
  blockId: string,
  context: AuditActorContext,
) =>
  runWithCalendarBlockMutationLocks(
    branchId,
    blockId,
    undefined,
    async (guard) => {
      await withTransaction(async (session) => {
        const block = await getCalendarBlockDocument(
          branchId,
          blockId,
          session,
        );
        if (block.status === "cancelled") return;
        block.status = "cancelled";
        await block.save({ session });
        await recordAudit(
          {
            context,
            action: "calendar_block.cancelled",
            entityType: "CalendarBlock",
            entityId: block._id,
          },
          session,
        );
        await guard.assertValid();
      });
      return getCalendarBlock(branchId, blockId);
    },
  );

const validateResourceServices = async (
  branchId: string,
  serviceIds: readonly string[],
  session?: ClientSession,
): Promise<Types.ObjectId[]> => {
  await requireBranch(branchId, session);
  const uniqueIds = [...new Set(serviceIds)];
  if (uniqueIds.length === 0) return [];

  const ids = uniqueIds.map(objectId);
  const [serviceCount, branchServiceCount] = await Promise.all([
    Service.countDocuments({ _id: { $in: ids } }).session(session ?? null),
    BranchService.countDocuments({
      branchId,
      serviceId: { $in: ids },
    }).session(session ?? null),
  ]);
  if (serviceCount !== ids.length) {
    throw ApiError.badRequest(
      "One or more linked services do not exist",
      undefined,
      "INVALID_RESOURCE_SERVICE",
    );
  }
  if (branchServiceCount !== ids.length) {
    throw ApiError.conflict(
      "Every resource service must be configured at this branch",
      undefined,
      "RESOURCE_SERVICE_NOT_AT_BRANCH",
    );
  }
  return ids;
};

export const listBookableResources = async (
  branchId: string,
  query: BookableResourceListQuery,
) => {
  await requireBranch(branchId);
  const pagination = parsePagination(query);
  const filter: QueryFilter<IBookableResource> = {
    branchId: objectId(branchId),
  };
  if (query.type) filter.type = query.type;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.serviceId) filter.serviceIds = objectId(query.serviceId);
  if (query.search) {
    const search = new RegExp(escapeRegExp(query.search), "i");
    filter.$or = [{ code: search }, { name: search }];
  }

  const [items, total] = await Promise.all([
    BookableResource.find(filter)
      .select("-__v")
      .sort({ type: 1, code: 1, _id: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    BookableResource.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, pagination) };
};

export const getBookableResource = async (
  branchId: string,
  resourceId: string,
) => {
  const resource = await BookableResource.findOne({
    _id: resourceId,
    branchId,
  })
    .select("-__v")
    .lean();
  if (!resource) {
    throw ApiError.notFound(
      "Bookable resource was not found",
      "BOOKABLE_RESOURCE_NOT_FOUND",
    );
  }
  return resource;
};

export const createBookableResource = (
  branchId: string,
  input: CreateBookableResourceBody,
  context: AuditActorContext,
) =>
  withBookingConfigWriteLease(branchId, async () => {
    const resourceId = await withTransaction(async (session) => {
      const serviceIds = await validateResourceServices(
        branchId,
        input.serviceIds,
        session,
      );
      const resource = new BookableResource({
        branchId: objectId(branchId),
        ...input,
        serviceIds,
      });
      await resource.save({ session });
      await recordAudit(
        {
          context,
          action: "bookable_resource.created",
          entityType: "BookableResource",
          entityId: resource._id,
          changes: { branchId, type: resource.type, code: resource.code },
        },
        session,
      );
      return resource._id;
    });
    return getBookableResource(branchId, resourceId.toString());
  });

export const updateBookableResource = (
  branchId: string,
  resourceId: string,
  input: UpdateBookableResourceBody,
  context: AuditActorContext,
) =>
  withBookingConfigWriteLease(branchId, async () => {
    await withTransaction(async (session) => {
      const resource = await BookableResource.findOne({
        _id: resourceId,
        branchId,
      }).session(session);
      if (!resource) {
        throw ApiError.notFound(
          "Bookable resource was not found",
          "BOOKABLE_RESOURCE_NOT_FOUND",
        );
      }
      const serviceIds =
        input.serviceIds === undefined
          ? undefined
          : await validateResourceServices(branchId, input.serviceIds, session);
      resource.set({
        ...input,
        ...(serviceIds ? { serviceIds } : {}),
      });
      await resource.save({ session });
      await recordAudit(
        {
          context,
          action: "bookable_resource.updated",
          entityType: "BookableResource",
          entityId: resource._id,
          changes: { changedFields: Object.keys(input) },
        },
        session,
      );
    });
    return getBookableResource(branchId, resourceId);
  });

export const deactivateBookableResource = (
  branchId: string,
  resourceId: string,
  context: AuditActorContext,
) =>
  withBookingConfigWriteLease(branchId, async () => {
    await withTransaction(async (session) => {
      const resource = await BookableResource.findOne({
        _id: resourceId,
        branchId,
      }).session(session);
      if (!resource) {
        throw ApiError.notFound(
          "Bookable resource was not found",
          "BOOKABLE_RESOURCE_NOT_FOUND",
        );
      }
      if (!resource.isActive) return;
      resource.isActive = false;
      await resource.save({ session });
      await recordAudit(
        {
          context,
          action: "bookable_resource.deactivated",
          entityType: "BookableResource",
          entityId: resource._id,
        },
        session,
      );
    });
    return getBookableResource(branchId, resourceId);
  });

export const schedulingService = {
  approveTimeOff,
  archiveEmployeeSchedule,
  cancelCalendarBlock,
  cancelMyTimeOff,
  cancelStaffTimeOff,
  createBookableResource,
  createCalendarBlock,
  createEmployeeSchedule,
  deactivateBookableResource,
  getBookableResource,
  getCalendarBlock,
  getEmployeeSchedule,
  listBookableResources,
  listCalendarBlocks,
  listEmployeeSchedules,
  listMyTimeOff,
  listStaffTimeOff,
  rejectTimeOff,
  requestMyTimeOff,
  updateBookableResource,
  updateCalendarBlock,
  updateEmployeeSchedule,
};
