import { Types, type QueryFilter } from "mongoose";

import Branch from "../models/business/Branch.js";
import BusinessSettings from "../models/business/BusinessSettings.js";
import BranchService from "../models/catalog/BranchService.js";
import Service, {
  type IServiceDuration,
} from "../models/catalog/Service.js";
import type { IPricePresentation } from "../models/core/pricing.js";
import type { ITimeInterval } from "../models/core/shared.js";
import BookableResource from "../models/scheduling/BookableResource.js";
import BranchHours from "../models/scheduling/BranchHours.js";
import CalendarBlock from "../models/scheduling/CalendarBlock.js";
import CalendarReservation, {
  type ICalendarReservation,
} from "../models/scheduling/CalendarReservation.js";
import EmployeeSchedule from "../models/scheduling/EmployeeSchedule.js";
import TimeOff from "../models/scheduling/TimeOff.js";
import Employee from "../models/staff/Employee.js";
import EmployeeService from "../models/staff/EmployeeService.js";
import EmployeeSkill from "../models/staff/EmployeeSkill.js";
import type { AvailabilityQuery } from "../validation/scheduling.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import {
  type CapacityRange,
  type MillisecondRange,
  canAllocateCapacity,
  enumerateAlignedStarts,
  everyRangeIsCovered,
  intersectRangeSets,
  rangesOverlap,
  subtractRanges,
} from "../utils/availability.js";
import {
  SYSTEM_TIME_ZONE,
  addLocalDays,
  compareLocalDates,
  dateToSystemPlainDate,
  localDateTimeToDate,
  systemDayOfWeek,
} from "../utils/dateTime.js";

export type AvailabilityCustomerGender =
  | "male"
  | "female"
  | "other"
  | "unspecified";

export type ServicePhaseKey =
  | "application"
  | "processing"
  | "finishing"
  | "buffer";

export interface ServiceSlotPhase {
  phaseKey: ServicePhaseKey;
  startAt: Date;
  endAt: Date;
  blocksEmployee: true;
  units: 1;
}

export interface ServiceSlotResourceAssignment {
  resourceType: "chair" | "room" | "equipment";
  resourceId: string;
  capacity: number;
  phaseKey: string;
  startAt: Date;
  endAt: Date;
  units: 1;
}

export type ServiceSlotUnavailableReason =
  | "DATE_OUTSIDE_BOOKING_WINDOW"
  | "MINIMUM_NOTICE_NOT_MET"
  | "SLOT_NOT_ALIGNED"
  | "BRANCH_CLOSED"
  | "BRANCH_BLOCKED"
  | "EMPLOYEE_NOT_ELIGIBLE"
  | "EMPLOYEE_NOT_SCHEDULED"
  | "EMPLOYEE_UNAVAILABLE"
  | "EMPLOYEE_CAPACITY_REACHED"
  | "RESOURCE_UNAVAILABLE";

export interface ServiceSlotCheck {
  available: boolean;
  reason?: ServiceSlotUnavailableReason;
  branchId: string;
  serviceId: string;
  employeeId: string;
  employeeCapacity: number;
  timeZone: string;
  startAt: Date;
  endAt: Date;
  duration: IServiceDuration;
  phases: ServiceSlotPhase[];
  resourceAssignments: ServiceSlotResourceAssignment[];
  price: IPricePresentation;
}

export interface CheckServiceSlotInput {
  branchId: string;
  serviceId: string;
  employeeId: string;
  startAt: Date;
  channel?: "online" | "staff";
  customerGender?: AvailabilityCustomerGender;
  excludeBookingId?: string;
  now?: Date;
}

interface EmployeeCandidate {
  employee: {
    _id: Types.ObjectId;
    name: string;
    title?: string;
    avatarUrl?: string;
    levelId?: Types.ObjectId;
    maxConcurrentClients: number;
    servesClientGender: "male" | "female" | "all";
  };
  assignment: {
    durationOverride?: IServiceDuration;
    priceOverride?: IPricePresentation;
    servesClientGenderOverride?: "male" | "female" | "all";
  };
  workingRanges: MillisecondRange[];
  unavailableRanges: MillisecondRange[];
  reservations: CapacityRange[];
}

interface ResourceCandidate {
  _id: Types.ObjectId;
  type: "chair" | "room" | "equipment";
  code: string;
  capacity: number;
  reservations: CapacityRange[];
}

interface AvailabilityContext {
  branchId: string;
  serviceId: string;
  date: string;
  dayStart: number;
  dayEnd: number;
  now: Date;
  slotIntervalMs: number;
  minimumStart: number;
  dateInWindow: boolean;
  service: {
    name: string;
    bookingMode: "instant" | "request" | "consultation_required";
    targetClientGender: "male" | "female" | "all";
    requiredSkillIds: Types.ObjectId[];
    duration: IServiceDuration;
    price: IPricePresentation;
    tierPrices: Array<{
      employeeLevelId: Types.ObjectId;
      price: IPricePresentation;
    }>;
  };
  branchService: {
    durationOverride?: IServiceDuration;
    priceOverride?: IPricePresentation;
  };
  allowProcessingOverlap: boolean;
  branchRanges: MillisecondRange[];
  branchUnavailableRanges: MillisecondRange[];
  employees: EmployeeCandidate[];
  resourcesByType: Map<
    "chair" | "room" | "equipment",
    ResourceCandidate[]
  >;
}

const MINUTE_MS = 60_000;
const objectId = (value: string): Types.ObjectId => new Types.ObjectId(value);

const activeReservationFilter = (
  now: Date,
  excludeBookingId?: string,
): QueryFilter<ICalendarReservation> => ({
  $or: [
    { status: "confirmed" },
    { status: "held", holdExpiresAt: { $gt: now } },
  ],
  ...(excludeBookingId
    ? { bookingId: { $ne: objectId(excludeBookingId) } }
    : {}),
});

const dateIntervalsToRanges = (
  date: string,
  intervals: readonly ITimeInterval[],
): MillisecondRange[] =>
  intervals.map((interval) => ({
    start: localDateTimeToDate(date, interval.start).getTime(),
    end: localDateTimeToDate(date, interval.end).getTime(),
  }));

const reservationToCapacityRange = (
  reservation: Pick<ICalendarReservation, "startAt" | "endAt" | "units">,
): CapacityRange => ({
  start: reservation.startAt.getTime(),
  end: reservation.endAt.getTime(),
  units: reservation.units,
});

const genderIsAllowed = (
  accepted: "male" | "female" | "all",
  customerGender: AvailabilityCustomerGender | undefined,
): boolean => {
  if (!customerGender || customerGender === "unspecified") return true;
  if (accepted === "all") return true;
  return customerGender !== "other" && accepted === customerGender;
};

const resolveDuration = (
  context: AvailabilityContext,
  candidate: EmployeeCandidate,
): IServiceDuration =>
  candidate.assignment.durationOverride ??
  context.branchService.durationOverride ??
  context.service.duration;

export interface AvailabilityPriceInput {
  employeePriceOverride?: IPricePresentation;
  employeeLevelId?: Types.ObjectId;
  tierPrices: Array<{
    employeeLevelId: Types.ObjectId;
    price: IPricePresentation;
  }>;
  branchPriceOverride?: IPricePresentation;
  basePrice: IPricePresentation;
}

export const resolveAvailabilityPrice = (
  input: AvailabilityPriceInput,
): IPricePresentation => {
  if (input.employeePriceOverride) return input.employeePriceOverride;
  if (input.employeeLevelId) {
    const tierPrice = input.tierPrices.find((tier) =>
      tier.employeeLevelId.equals(input.employeeLevelId),
    );
    if (tierPrice) return tierPrice.price;
  }
  return input.branchPriceOverride ?? input.basePrice;
};

const resolvePrice = (
  context: AvailabilityContext,
  candidate: EmployeeCandidate,
): IPricePresentation =>
  resolveAvailabilityPrice({
    employeePriceOverride: candidate.assignment.priceOverride,
    employeeLevelId: candidate.employee.levelId,
    tierPrices: context.service.tierPrices,
    branchPriceOverride: context.branchService.priceOverride,
    basePrice: context.service.price,
  });

const buildPhases = (
  start: number,
  duration: IServiceDuration,
  allowProcessingOverlap: boolean,
): { blocking: ServiceSlotPhase[]; end: number } => {
  const blocking: ServiceSlotPhase[] = [];
  let cursor = start;
  const add = (
    phaseKey: ServicePhaseKey,
    minutes: number,
    blocksEmployee: boolean,
  ): void => {
    const phaseStart = cursor;
    cursor += minutes * MINUTE_MS;
    if (minutes > 0 && blocksEmployee) {
      blocking.push({
        phaseKey,
        startAt: new Date(phaseStart),
        endAt: new Date(cursor),
        blocksEmployee: true,
        units: 1,
      });
    }
  };

  add("application", duration.applicationMinutes, true);
  add(
    "processing",
    duration.processingMinutes,
    duration.processingBlocksEmployee || !allowProcessingOverlap,
  );
  add("finishing", duration.finishingMinutes, true);
  add("buffer", duration.bufferMinutes, true);
  return { blocking, end: cursor };
};

const phaseRanges = (
  phases: readonly ServiceSlotPhase[],
): CapacityRange[] =>
  phases.map((phase) => ({
    start: phase.startAt.getTime(),
    end: phase.endAt.getTime(),
    units: phase.units,
  }));

const isAlignedStart = (
  start: number,
  origin: number,
  interval: number,
): boolean => (start - origin) % interval === 0;

const selectResourceAssignments = (
  context: AvailabilityContext,
  start: number,
  end: number,
): ServiceSlotResourceAssignment[] | null => {
  const requested: CapacityRange[] = [{ start, end, units: 1 }];
  const assignments: ServiceSlotResourceAssignment[] = [];
  const types = ["chair", "room", "equipment"] as const;

  for (const type of types) {
    const resources = context.resourcesByType.get(type);
    if (!resources || resources.length === 0) continue;
    const resource = resources.find((candidate) =>
      canAllocateCapacity(
        candidate.reservations.filter((reservation) =>
          rangesOverlap(reservation, requested[0]),
        ),
        requested,
        candidate.capacity,
      ),
    );
    if (!resource) return null;
    assignments.push({
      resourceType: type,
      resourceId: resource._id.toString(),
      capacity: resource.capacity,
      phaseKey: `resource:${type}`,
      startAt: new Date(start),
      endAt: new Date(end),
      units: 1,
    });
  }
  return assignments;
};

const createUnavailableCheck = (
  context: AvailabilityContext,
  candidate: EmployeeCandidate,
  start: number,
  reason: ServiceSlotUnavailableReason,
): ServiceSlotCheck => {
  const duration = resolveDuration(context, candidate);
  const phaseResult = buildPhases(
    start,
    duration,
    context.allowProcessingOverlap,
  );
  return {
    available: false,
    reason,
    branchId: context.branchId,
    serviceId: context.serviceId,
    employeeId: candidate.employee._id.toString(),
    employeeCapacity: candidate.employee.maxConcurrentClients,
    timeZone: SYSTEM_TIME_ZONE,
    startAt: new Date(start),
    endAt: new Date(phaseResult.end),
    duration,
    phases: phaseResult.blocking,
    resourceAssignments: [],
    price: resolvePrice(context, candidate),
  };
};

const evaluateCandidate = (
  context: AvailabilityContext,
  candidate: EmployeeCandidate,
  start: number,
): ServiceSlotCheck => {
  const duration = resolveDuration(context, candidate);
  const { blocking, end } = buildPhases(
    start,
    duration,
    context.allowProcessingOverlap,
  );
  const overall = { start, end };
  const required = phaseRanges(blocking);

  if (!context.dateInWindow) {
    return createUnavailableCheck(
      context,
      candidate,
      start,
      "DATE_OUTSIDE_BOOKING_WINDOW",
    );
  }
  if (start < context.minimumStart) {
    return createUnavailableCheck(
      context,
      candidate,
      start,
      "MINIMUM_NOTICE_NOT_MET",
    );
  }
  if (!isAlignedStart(start, context.dayStart, context.slotIntervalMs)) {
    return createUnavailableCheck(
      context,
      candidate,
      start,
      "SLOT_NOT_ALIGNED",
    );
  }
  if (
    !context.branchRanges.some((branchRange) =>
      branchRange.start <= start && end <= branchRange.end
    )
  ) {
    return createUnavailableCheck(
      context,
      candidate,
      start,
      "BRANCH_CLOSED",
    );
  }
  if (
    context.branchUnavailableRanges.some((range) =>
      rangesOverlap(range, overall),
    )
  ) {
    return createUnavailableCheck(
      context,
      candidate,
      start,
      "BRANCH_BLOCKED",
    );
  }
  const employeeIsPresentAtStart = candidate.workingRanges.some(
    (range) => range.start <= start && start < range.end,
  );
  if (
    !employeeIsPresentAtStart ||
    !everyRangeIsCovered(required, candidate.workingRanges)
  ) {
    return createUnavailableCheck(
      context,
      candidate,
      start,
      "EMPLOYEE_NOT_SCHEDULED",
    );
  }
  if (
    candidate.unavailableRanges.some((unavailable) =>
      required.some((range) => rangesOverlap(unavailable, range)),
    )
  ) {
    return createUnavailableCheck(
      context,
      candidate,
      start,
      "EMPLOYEE_UNAVAILABLE",
    );
  }
  const relevantReservations = candidate.reservations.filter((reservation) =>
    required.some((range) => rangesOverlap(reservation, range)),
  );
  if (
    !canAllocateCapacity(
      relevantReservations,
      required,
      candidate.employee.maxConcurrentClients,
    )
  ) {
    return createUnavailableCheck(
      context,
      candidate,
      start,
      "EMPLOYEE_CAPACITY_REACHED",
    );
  }

  const resourceAssignments = selectResourceAssignments(context, start, end);
  if (!resourceAssignments) {
    return createUnavailableCheck(
      context,
      candidate,
      start,
      "RESOURCE_UNAVAILABLE",
    );
  }

  return {
    available: true,
    branchId: context.branchId,
    serviceId: context.serviceId,
    employeeId: candidate.employee._id.toString(),
    employeeCapacity: candidate.employee.maxConcurrentClients,
    timeZone: SYSTEM_TIME_ZONE,
    startAt: new Date(start),
    endAt: new Date(end),
    duration,
    phases: blocking,
    resourceAssignments,
    price: resolvePrice(context, candidate),
  };
};

const loadAvailabilityContext = async (input: {
  branchId: string;
  serviceId: string;
  date: string;
  employeeId?: string;
  channel: "online" | "staff";
  customerGender?: AvailabilityCustomerGender;
  excludeBookingId?: string;
  now: Date;
}): Promise<AvailabilityContext> => {
  const [branch, service, branchService, settings] = await Promise.all([
    Branch.findById(input.branchId)
      .select("name isActive bookingsEnabled")
      .lean(),
    Service.findById(input.serviceId)
      .select(
        "name targetClientGender requiredSkillIds duration price tierPrices bookingMode isActive isOnlineBookable",
      )
      .lean(),
    BranchService.findOne({
      branchId: input.branchId,
      serviceId: input.serviceId,
    })
      .select(
        "durationOverride priceOverride isActive isOnlineBookable",
      )
      .lean(),
    BusinessSettings.findOne({ singletonKey: "default" })
      .select(
        "booking.slotIntervalMinutes booking.minimumNoticeMinutes booking.maximumAdvanceDays booking.allowProcessingOverlap",
      )
      .lean(),
  ]);

  if (!branch || !branch.isActive || !branch.bookingsEnabled) {
    throw ApiError.notFound(
      "Branch is unavailable for bookings",
      "BRANCH_BOOKING_UNAVAILABLE",
    );
  }
  if (
    !service ||
    !service.isActive ||
    (input.channel === "online" && !service.isOnlineBookable) ||
    service.bookingMode === "consultation_required"
  ) {
    throw ApiError.notFound(
      "Service is unavailable for this booking channel",
      "SERVICE_BOOKING_UNAVAILABLE",
    );
  }
  if (
    !branchService ||
    !branchService.isActive ||
    (input.channel === "online" && !branchService.isOnlineBookable)
  ) {
    throw ApiError.notFound(
      "Service is unavailable at this branch",
      "BRANCH_SERVICE_UNAVAILABLE",
    );
  }
  if (!settings) {
    throw new ApiError(503, "Booking settings have not been configured", {
      code: "BOOKING_SETTINGS_UNAVAILABLE",
    });
  }

  const dayStart = localDateTimeToDate(input.date, "00:00").getTime();
  const dayEnd = localDateTimeToDate(
    addLocalDays(input.date, 1),
    "00:00",
  ).getTime();
  const today = dateToSystemPlainDate(input.now);
  const latestDate = addLocalDays(today, settings.booking.maximumAdvanceDays);
  const dateInWindow =
    compareLocalDates(input.date, today) >= 0 &&
    compareLocalDates(input.date, latestDate) <= 0;
  const minimumStart =
    input.channel === "staff"
      ? input.now.getTime()
      : input.now.getTime() +
        settings.booking.minimumNoticeMinutes * MINUTE_MS;
  const reservationFilter = activeReservationFilter(
    input.now,
    input.excludeBookingId,
  );

  const branchHours = await BranchHours.findOne({
    branchId: input.branchId,
    status: "active",
    effectiveFrom: { $lte: input.date },
    $or: [
      { effectiveUntil: { $exists: false } },
      { effectiveUntil: null },
      { effectiveUntil: { $gt: input.date } },
    ],
  })
    .select("days")
    .sort({ effectiveFrom: -1, _id: -1 })
    .lean();
  const dayOfWeek = systemDayOfWeek(input.date);
  const hoursDay = branchHours?.days.find(
    (day) => day.dayOfWeek === dayOfWeek,
  );
  const branchRanges =
    hoursDay && !hoursDay.isClosed
      ? dateIntervalsToRanges(input.date, hoursDay.intervals)
      : [];

  const [branchBlocks, branchReservations, assignments, resources] =
    await Promise.all([
      CalendarBlock.find({
        branchId: input.branchId,
        status: "active",
        blocksBookings: true,
        startAt: { $lt: new Date(dayEnd) },
        endAt: { $gt: new Date(dayStart) },
        $or: [
          { employeeId: { $exists: false } },
          { employeeId: null },
        ],
      })
        .select("startAt endAt")
        .lean(),
      CalendarReservation.find({
        branchId: input.branchId,
        resourceType: "branch",
        resourceId: objectId(input.branchId),
        startAt: { $lt: new Date(dayEnd) },
        endAt: { $gt: new Date(dayStart) },
        ...reservationFilter,
      })
        .select("startAt endAt units")
        .lean(),
      EmployeeService.find({
        branchId: input.branchId,
        serviceId: input.serviceId,
        isActive: true,
        ...(input.channel === "online" ? { isOnlineBookable: true } : {}),
        ...(input.employeeId ? { employeeId: input.employeeId } : {}),
        $and: [
          {
            $or: [
              { validFrom: { $exists: false } },
              { validFrom: null },
              { validFrom: { $lte: input.date } },
            ],
          },
          {
            $or: [
              { validUntil: { $exists: false } },
              { validUntil: null },
              { validUntil: { $gt: input.date } },
            ],
          },
        ],
      })
        .select(
          "employeeId durationOverride priceOverride servesClientGenderOverride",
        )
        .lean(),
      BookableResource.find({
        branchId: input.branchId,
        isActive: true,
        serviceIds: objectId(input.serviceId),
      })
        .select("type code capacity")
        .sort({ type: 1, code: 1, _id: 1 })
        .lean(),
    ]);

  const branchUnavailableRanges: MillisecondRange[] = [
    ...branchBlocks.map((block) => ({
      start: block.startAt.getTime(),
      end: block.endAt.getTime(),
    })),
    ...branchReservations.map(reservationToCapacityRange),
  ];

  const employeeIds = assignments.map((assignment) => assignment.employeeId);
  const employees =
    employeeIds.length === 0
      ? []
      : await Employee.find({
          _id: { $in: employeeIds },
          status: "active",
          isBookable: true,
          ...(input.channel === "online"
            ? { acceptsOnlineBookings: true }
            : {}),
          branchIds: objectId(input.branchId),
        })
          .select(
            "name title avatarUrl levelId maxConcurrentClients servesClientGender",
          )
          .sort({ name: 1, _id: 1 })
          .lean();

  const eligibleEmployeeIds = employees.map((employee) => employee._id);
  const [
    skills,
    schedules,
    timeOff,
    employeeBlocks,
    employeeReservations,
    resourceReservations,
  ] = await Promise.all([
    eligibleEmployeeIds.length === 0 || service.requiredSkillIds.length === 0
      ? Promise.resolve([])
      : EmployeeSkill.find({
          employeeId: { $in: eligibleEmployeeIds },
          skillId: { $in: service.requiredSkillIds },
          isActive: true,
        })
          .select("employeeId skillId certifiedAt expiresAt")
          .lean(),
    eligibleEmployeeIds.length === 0
      ? Promise.resolve([])
      : EmployeeSchedule.find({
          employeeId: { $in: eligibleEmployeeIds },
          branchId: input.branchId,
          status: "active",
          effectiveFrom: { $lte: input.date },
          $or: [
            { effectiveUntil: { $exists: false } },
            { effectiveUntil: null },
            { effectiveUntil: { $gt: input.date } },
          ],
        })
          .select("employeeId days")
          .sort({ effectiveFrom: -1, _id: -1 })
          .lean(),
    eligibleEmployeeIds.length === 0
      ? Promise.resolve([])
      : TimeOff.find({
          employeeId: { $in: eligibleEmployeeIds },
          status: "approved",
          startAt: { $lt: new Date(dayEnd) },
          endAt: { $gt: new Date(dayStart) },
          $or: [
            { allBranches: true },
            { branchIds: objectId(input.branchId) },
          ],
        })
          .select("employeeId startAt endAt")
          .lean(),
    eligibleEmployeeIds.length === 0
      ? Promise.resolve([])
      : CalendarBlock.find({
          branchId: input.branchId,
          employeeId: { $in: eligibleEmployeeIds },
          status: "active",
          blocksBookings: true,
          startAt: { $lt: new Date(dayEnd) },
          endAt: { $gt: new Date(dayStart) },
        })
          .select("employeeId startAt endAt")
          .lean(),
    eligibleEmployeeIds.length === 0
      ? Promise.resolve([])
      : CalendarReservation.find({
          branchId: input.branchId,
          resourceType: "employee",
          resourceId: { $in: eligibleEmployeeIds },
          startAt: { $lt: new Date(dayEnd) },
          endAt: { $gt: new Date(dayStart) },
          ...reservationFilter,
        })
          .select("resourceId startAt endAt units")
          .lean(),
    resources.length === 0
      ? Promise.resolve([])
      : CalendarReservation.find({
          branchId: input.branchId,
          resourceType: { $in: ["chair", "room", "equipment"] },
          resourceId: { $in: resources.map((resource) => resource._id) },
          startAt: { $lt: new Date(dayEnd) },
          endAt: { $gt: new Date(dayStart) },
          ...reservationFilter,
        })
          .select("resourceId startAt endAt units")
          .lean(),
  ]);

  const assignmentByEmployeeId = new Map(
    assignments.map((assignment) => [
      assignment.employeeId.toString(),
      assignment,
    ]),
  );
  const scheduleByEmployeeId = new Map(
    schedules.map((schedule) => [schedule.employeeId.toString(), schedule]),
  );
  const requiredSkillIds = new Set(
    service.requiredSkillIds.map((skillId) => skillId.toString()),
  );

  const employeeCandidates: EmployeeCandidate[] = employees.flatMap((employee) => {
    const employeeId = employee._id.toString();
    const assignment = assignmentByEmployeeId.get(employeeId);
    if (!assignment) return [];
    const servedGender =
      assignment.servesClientGenderOverride ?? employee.servesClientGender;
    if (
      !genderIsAllowed(service.targetClientGender, input.customerGender) ||
      !genderIsAllowed(servedGender, input.customerGender)
    ) {
      return [];
    }

    if (requiredSkillIds.size > 0) {
      const employeeSkillIds = new Set(
        skills
          .filter(
            (skill) =>
              skill.employeeId.equals(employee._id) &&
              (!skill.certifiedAt || skill.certifiedAt <= input.date) &&
              (!skill.expiresAt || skill.expiresAt >= input.date),
          )
          .map((skill) => skill.skillId.toString()),
      );
      if (
        [...requiredSkillIds].some(
          (requiredSkillId) => !employeeSkillIds.has(requiredSkillId),
        )
      ) {
        return [];
      }
    }

    const schedule = scheduleByEmployeeId.get(employeeId);
    const scheduleDay = schedule?.days.find(
      (day) => day.dayOfWeek === dayOfWeek,
    );
    const shiftRanges = scheduleDay
      ? dateIntervalsToRanges(input.date, scheduleDay.shifts)
      : [];
    const breakRanges = scheduleDay
      ? dateIntervalsToRanges(input.date, scheduleDay.breaks)
      : [];
    const workingRanges = subtractRanges(
      intersectRangeSets(shiftRanges, branchRanges),
      breakRanges,
    );

    const unavailableRanges = [
      ...timeOff
        .filter((entry) => entry.employeeId.equals(employee._id))
        .map((entry) => ({
          start: entry.startAt.getTime(),
          end: entry.endAt.getTime(),
        })),
      ...employeeBlocks
        .filter((block) => block.employeeId?.equals(employee._id))
        .map((block) => ({
          start: block.startAt.getTime(),
          end: block.endAt.getTime(),
        })),
    ];
    const reservations = employeeReservations
      .filter((reservation) => reservation.resourceId.equals(employee._id))
      .map(reservationToCapacityRange);

    return [
      {
        employee: {
          _id: employee._id,
          name: employee.name,
          title: employee.title,
          avatarUrl: employee.avatarUrl,
          levelId: employee.levelId,
          maxConcurrentClients: employee.maxConcurrentClients,
          servesClientGender: employee.servesClientGender,
        },
        assignment: {
          durationOverride: assignment.durationOverride,
          priceOverride: assignment.priceOverride,
          servesClientGenderOverride: assignment.servesClientGenderOverride,
        },
        workingRanges,
        unavailableRanges,
        reservations,
      },
    ];
  });

  const resourceReservationsById = new Map<string, CapacityRange[]>();
  for (const reservation of resourceReservations) {
    const key = reservation.resourceId.toString();
    const current = resourceReservationsById.get(key) ?? [];
    current.push(reservationToCapacityRange(reservation));
    resourceReservationsById.set(key, current);
  }
  const resourcesByType: AvailabilityContext["resourcesByType"] = new Map();
  for (const resource of resources) {
    const current = resourcesByType.get(resource.type) ?? [];
    current.push({
      _id: resource._id,
      type: resource.type,
      code: resource.code,
      capacity: resource.capacity,
      reservations: resourceReservationsById.get(resource._id.toString()) ?? [],
    });
    resourcesByType.set(resource.type, current);
  }

  return {
    branchId: input.branchId,
    serviceId: input.serviceId,
    date: input.date,
    dayStart,
    dayEnd,
    now: input.now,
    slotIntervalMs: settings.booking.slotIntervalMinutes * MINUTE_MS,
    minimumStart,
    dateInWindow,
    service: {
      name: service.name,
      bookingMode: service.bookingMode,
      targetClientGender: service.targetClientGender,
      requiredSkillIds: service.requiredSkillIds,
      duration: service.duration,
      price: service.price,
      tierPrices: service.tierPrices,
    },
    branchService: {
      durationOverride: branchService.durationOverride,
      priceOverride: branchService.priceOverride,
    },
    allowProcessingOverlap: settings.booking.allowProcessingOverlap,
    branchRanges,
    branchUnavailableRanges,
    employees: employeeCandidates,
    resourcesByType,
  };
};

export const checkServiceSlot = async (
  input: CheckServiceSlotInput,
): Promise<ServiceSlotCheck> => {
  const now = input.now ?? new Date();
  const date = dateToSystemPlainDate(input.startAt);
  const context = await loadAvailabilityContext({
    branchId: input.branchId,
    serviceId: input.serviceId,
    employeeId: input.employeeId,
    channel: input.channel ?? "online",
    date,
    customerGender: input.customerGender,
    excludeBookingId: input.excludeBookingId,
    now,
  });
  const employee = context.employees.find(
    (candidate) => candidate.employee._id.toString() === input.employeeId,
  );
  if (!employee) {
    const baseDuration =
      context.branchService.durationOverride ?? context.service.duration;
    const phaseResult = buildPhases(
      input.startAt.getTime(),
      baseDuration,
      context.allowProcessingOverlap,
    );
    return {
      available: false,
      reason: "EMPLOYEE_NOT_ELIGIBLE",
      branchId: input.branchId,
      serviceId: input.serviceId,
      employeeId: input.employeeId,
      employeeCapacity: 1,
      timeZone: SYSTEM_TIME_ZONE,
      startAt: input.startAt,
      endAt: new Date(phaseResult.end),
      duration: baseDuration,
      phases: phaseResult.blocking,
      resourceAssignments: [],
      price: context.branchService.priceOverride ?? context.service.price,
    };
  }
  return evaluateCandidate(context, employee, input.startAt.getTime());
};

export const listPublicAvailability = async (
  query: AvailabilityQuery,
  now = new Date(),
) => {
  const context = await loadAvailabilityContext({
    ...query,
    channel: "online",
    now,
  });
  const employees = context.employees.map((candidate) => {
    const duration = resolveDuration(context, candidate);
    const totalMinutes =
      duration.applicationMinutes +
      duration.processingMinutes +
      duration.finishingMinutes +
      duration.bufferMinutes;
    const candidateStarts = enumerateAlignedStarts(
      context.branchRanges,
      context.dayStart,
      context.slotIntervalMs,
      totalMinutes * MINUTE_MS,
    );
    const slots = candidateStarts
      .map((start) => evaluateCandidate(context, candidate, start))
      .filter((slot) => slot.available)
      .map((slot) => ({
        startAt: slot.startAt,
        endAt: slot.endAt,
        duration: slot.duration,
        price: slot.price,
        phases: slot.phases.map((phase) => ({
          phaseKey: phase.phaseKey,
          startAt: phase.startAt,
          endAt: phase.endAt,
        })),
      }));

    return {
      employee: {
        id: candidate.employee._id.toString(),
        name: candidate.employee.name,
        title: candidate.employee.title,
        avatarUrl: candidate.employee.avatarUrl,
      },
      slots,
    };
  });

  return {
    branchId: query.branchId,
    service: {
      id: query.serviceId,
      name: context.service.name,
      bookingMode: context.service.bookingMode,
    },
    date: query.date,
    timeZone: SYSTEM_TIME_ZONE,
    generatedAt: now,
    employees,
    totalSlots: employees.reduce(
      (total, employee) => total + employee.slots.length,
      0,
    ),
  };
};

export const availabilityService = {
  checkServiceSlot,
  listPublicAvailability,
};
