import { createHash } from "node:crypto";

import type { ClientSession, QueryFilter } from "mongoose";
import { Types } from "mongoose";

import Booking, {
  type BookingStatus,
  type IBooking,
} from "../models/bookings/Booking.js";
import BookingInquiry from "../models/bookings/BookingInquiry.js";
import BookingItem from "../models/bookings/BookingItem.js";
import BookingQuote from "../models/bookings/BookingQuote.js";
import WaitlistEntry from "../models/bookings/WaitlistEntry.js";
import BusinessSettings from "../models/business/BusinessSettings.js";
import BranchService from "../models/catalog/BranchService.js";
import Product from "../models/catalog/Product.js";
import Service from "../models/catalog/Service.js";
import type {
  AdvanceRequirement,
  IAdvancePolicy,
  IPricePresentation,
  PriceMode,
} from "../models/core/pricing.js";
import Customer from "../models/customers/Customer.js";
import OutboxEvent from "../models/events/OutboxEvent.js";
import CalendarReservation from "../models/scheduling/CalendarReservation.js";
import Employee from "../models/staff/Employee.js";
import type { BookingRequestContext } from "../types/booking-api.js";
import { ApiError } from "../utils/ApiError.js";
import { withTransaction } from "../utils/database.js";
import {
  addLocalDays,
  compareLocalDates,
  dateToSystemPlainDate,
} from "../utils/dateTime.js";
import {
  buildPaginationMeta,
  parsePagination,
  parseSort,
} from "../utils/pagination.js";
import type {
  BookingListQuery,
  CancelBookingBody,
  CreateBookingBody,
  EmployeeBookingListQuery,
  ExternalSettlementBody,
  RescheduleBookingBody,
  ScheduleAcceptedQuoteBody,
  TransitionBookingBody,
} from "../validation/booking.schemas.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";
import {
  BOOKING_CONFIG_LEASE_TTL_MS,
  bookingConfigLeaseScope,
} from "./booking-config-lock.service.js";
import {
  assertActorCanAccessBranch,
  requireCustomerForActor,
  requireStaffScope,
  schedulingGender,
  scopeBookingFilter,
} from "./booking-access.service.js";
import {
  checkServiceSlot,
  type ServiceSlotCheck,
} from "./availability.service.js";
import {
  assertInRequestAllocationCapacity,
  assertRescheduleAssignmentsAllowed,
  buildEmployeeTravelBlocks,
  type BookingTravelPolicy,
  type EmployeeTravelBlock,
} from "./booking-allocation.service.js";
import {
  bookingRepository,
  confirmBookingReservations,
  releaseBookingReservations,
  setBookingItemsStatus,
} from "../repositories/booking.repository.js";
import {
  redisService,
  type DistributedLock,
  type DistributedReadWriteLease,
} from "./redis.service.js";
import { assertEmployeeTravelAvailability } from "./travel-availability.service.js";

const ACTIVE_STATUSES: BookingStatus[] = [
  "requested",
  "pending_advance",
  "confirmed",
  "checked_in",
  "in_progress",
];

const BOOKING_TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  requested: ["confirmed", "cancelled"],
  pending_advance: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_progress", "cancelled", "no_show"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};

interface ResolvedBookingItem {
  service: {
    _id: Types.ObjectId;
    code: string;
    name: string;
    targetClientGender: "male" | "female" | "all";
    bookingMode: "instant" | "request" | "consultation_required";
    advancePolicy?: IAdvancePolicy;
  };
  employee: {
    _id: Types.ObjectId;
    name: string;
    title?: string;
  };
  branchAdvancePolicy?: IAdvancePolicy;
  slot: ServiceSlotCheck;
}

interface BookingSettingsSnapshot {
  temporaryHoldMinutes: number;
  cancellationWindowHours: number;
  defaultAdvance: IAdvancePolicy;
}

interface CreateResolvedAggregateInput {
  branchId: string;
  customer: {
    _id: Types.ObjectId;
    name: string;
    email?: string;
    phone?: string;
  };
  resolvedItems: ResolvedBookingItem[];
  travelBlocks: EmployeeTravelBlock[];
  settings: BookingSettingsSnapshot;
  actorUserId: string;
  source: IBooking["source"];
  idempotencyKey?: string;
  quoteId?: Types.ObjectId;
  quoteLineIds?: Array<Types.ObjectId | undefined>;
  quotedAmounts?: Array<number | undefined>;
  quotedTotalMinor?: number;
  advanceRequirementOverride?: AdvanceRequirement;
  advanceDueOverride?: number;
  customerAcceptedVariablePricing: boolean;
  customerNote?: string | null;
  internalNote?: string | null;
  event?: {
    type: "standard" | "group" | "wedding" | "offsite";
    name?: string | null;
    partySize: number;
    offsiteAddress?: string | null;
    travelMinutesBefore?: number;
    travelMinutesAfter?: number;
  };
  includedProducts?: Array<{
    productId: Types.ObjectId;
    code: string;
    name: string;
    quantity: number;
  }>;
  session: ClientSession;
}

const addOutbox = async (
  aggregateId: Types.ObjectId,
  eventType: string,
  payload: Record<string, unknown>,
  session: ClientSession,
): Promise<void> => {
  await OutboxEvent.create(
    [
      {
        aggregateType: "booking",
        aggregateId,
        eventType,
        payload,
      },
    ],
    { session },
  );
};

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const makeIdempotencyKey = (
  customerId: string,
  operation: string,
  rawKey: string,
  fingerprint: string,
): { base: string; stored: string } => {
  const base = hash(`${customerId}:${operation}:${rawKey}`);
  return { base, stored: `${base}:${fingerprint}` };
};

const requireIdempotencyKey = (rawKey: string | undefined): string => {
  const key = rawKey?.trim();
  if (!key || key.length < 8 || key.length > 200) {
    throw ApiError.badRequest(
      "Idempotency-Key must contain 8 to 200 characters",
      undefined,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  }
  return key;
};

const getSettings = async (): Promise<BookingSettingsSnapshot> => {
  const settings = await BusinessSettings.findOne({ singletonKey: "default" })
    .select(
      "booking.temporaryHoldMinutes booking.cancellationWindowHours defaultAdvance",
    )
    .lean();
  if (!settings) {
    throw new ApiError(503, "Booking settings have not been configured", {
      code: "BOOKING_SETTINGS_UNAVAILABLE",
    });
  }
  return {
    temporaryHoldMinutes: settings.booking.temporaryHoldMinutes,
    cancellationWindowHours: settings.booking.cancellationWindowHours,
    defaultAdvance: settings.defaultAdvance,
  };
};

const loadResolvedItemMetadata = async (
  branchId: string,
  slots: ServiceSlotCheck[],
): Promise<ResolvedBookingItem[]> => {
  const serviceIds = [...new Set(slots.map((slot) => slot.serviceId))];
  const employeeIds = [...new Set(slots.map((slot) => slot.employeeId))];
  const [services, employees, branchServices] = await Promise.all([
    Service.find({ _id: { $in: serviceIds }, isActive: true })
      .select("code name targetClientGender bookingMode advancePolicy")
      .lean(),
    Employee.find({ _id: { $in: employeeIds }, status: "active" })
      .select("name title")
      .lean(),
    BranchService.find({
      branchId,
      serviceId: { $in: serviceIds },
      isActive: true,
    })
      .select("serviceId advancePolicyOverride")
      .lean(),
  ]);
  const serviceMap = new Map(
    services.map((service) => [service._id.toString(), service]),
  );
  const employeeMap = new Map(
    employees.map((employee) => [employee._id.toString(), employee]),
  );
  const branchServiceMap = new Map(
    branchServices.map((entry) => [entry.serviceId.toString(), entry]),
  );
  if (
    serviceMap.size !== serviceIds.length ||
    employeeMap.size !== employeeIds.length ||
    branchServiceMap.size !== serviceIds.length
  ) {
    throw ApiError.conflict(
      "Booking configuration changed while the slot was selected",
      "BOOKING_CONFIGURATION_CHANGED",
    );
  }
  return slots.map((slot) => {
    const service = serviceMap.get(slot.serviceId)!;
    const employee = employeeMap.get(slot.employeeId)!;
    const branchService = branchServiceMap.get(slot.serviceId)!;
    return {
      service: {
        _id: service._id,
        code: service.code,
        name: service.name,
        targetClientGender: service.targetClientGender,
        bookingMode: service.bookingMode,
        advancePolicy: service.advancePolicy,
      },
      employee: {
        _id: employee._id,
        name: employee.name,
        title: employee.title,
      },
      branchAdvancePolicy: branchService.advancePolicyOverride,
      slot,
    };
  });
};

const ensureSlotsAvailable = (
  slots: ServiceSlotCheck[],
  travelBlocks: readonly EmployeeTravelBlock[] = [],
): void => {
  const unavailable = slots.find((slot) => !slot.available);
  if (unavailable) {
    throw ApiError.conflict(
      "The selected appointment slot is no longer available",
      {
        serviceId: unavailable.serviceId,
        employeeId: unavailable.employeeId,
        startAt: unavailable.startAt,
        reason: unavailable.reason,
      },
      "BOOKING_SLOT_UNAVAILABLE",
    );
  }

  assertInRequestAllocationCapacity(slots, travelBlocks);
};

const intervalLockDates = (startAt: Date, endAt: Date): string[] => {
  const lastInstant = new Date(Math.max(startAt.getTime(), endAt.getTime() - 1));
  const lastDate = dateToSystemPlainDate(lastInstant);
  const dates: string[] = [];
  for (
    let date = dateToSystemPlainDate(startAt);
    compareLocalDates(date, lastDate) <= 0;
    date = addLocalDays(date, 1)
  ) {
    dates.push(date);
  }
  return dates;
};

const slotLockKeys = (
  branchId: string,
  slots: ServiceSlotCheck[],
): string[] => {
  return slots.flatMap((slot) => [
    ...intervalLockDates(slot.startAt, slot.endAt).map(
      (date) => `booking:branch:${branchId}:${date}`,
    ),
    ...slot.phases.flatMap((phase) =>
      intervalLockDates(phase.startAt, phase.endAt).map(
        (date) => `booking:employee:${slot.employeeId}:${date}`,
      ),
    ),
    ...slot.resourceAssignments.flatMap((resource) =>
      intervalLockDates(resource.startAt, resource.endAt).map(
        (date) =>
          `booking:${resource.resourceType}:${resource.resourceId}:${date}`,
      ),
    ),
  ]);
};

const travelBlockLockKeys = (
  branchId: string,
  travelBlocks: readonly EmployeeTravelBlock[],
): string[] =>
  travelBlocks.flatMap((block) =>
    intervalLockDates(block.startAt, block.endAt).flatMap((date) => [
      `booking:branch:${branchId}:${date}`,
      `booking:employee:${block.employeeId}:${date}`,
    ]),
  );

interface SlotLockLease {
  locks: DistributedLock[];
  assertValid: () => Promise<void>;
  release: () => Promise<void>;
}

const createSlotLockLease = (
  locks: DistributedLock[],
  configLease: DistributedReadWriteLease,
  ttlMs: number,
): SlotLockLease => {
  let stopped = false;
  let lost = false;
  let renewalRunning = false;
  const timer = setInterval(() => {
    if (stopped || renewalRunning) return;
    renewalRunning = true;
    void Promise.all([
      ...locks.map(({ key, token }) =>
        redisService.extendLock(key, token, ttlMs),
      ),
      redisService.extendReadWriteLease(configLease, ttlMs),
    ])
      .then((results) => {
        if (results.some((extended) => !extended)) lost = true;
      })
      .catch(() => {
        lost = true;
      })
      .finally(() => {
        renewalRunning = false;
      });
  }, Math.floor(ttlMs / 3));
  timer.unref();

  return {
    locks,
    assertValid: async () => {
      const ownership = await Promise.all([
        ...locks.map(({ key, token }) =>
          redisService.extendLock(key, token, ttlMs),
        ),
        redisService.extendReadWriteLease(configLease, ttlMs),
      ]);
      if (
        lost ||
        ownership.some((owned) => !owned) ||
        !(await redisService.isReadWriteLeaseValid(configLease))
      ) {
        lost = true;
        throw new ApiError(503, "Booking reservation lock was lost; retry safely", {
          code: "BOOKING_LOCK_LOST",
        });
      }
    },
    release: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await Promise.allSettled([
        redisService.releaseLocks(locks),
        redisService.releaseReadWriteLease(configLease),
      ]);
    },
  };
};

const checkSlots = async (
  inputs: CreateBookingBody["items"],
  options: {
    branchId: string;
    customerGender: string;
    staff: boolean;
    excludeBookingId?: string;
    now: Date;
  },
): Promise<ServiceSlotCheck[]> =>
  Promise.all(
    inputs.map((item) =>
      checkServiceSlot({
        branchId: options.branchId,
        serviceId: item.serviceId,
        employeeId: item.employeeId,
        startAt: item.startAt,
        channel: options.staff ? "staff" : "online",
        customerGender: schedulingGender(options.customerGender),
        excludeBookingId: options.excludeBookingId,
        now: options.now,
      }),
    ),
  );

const lockAndRecheckSlots = async (
  inputs: CreateBookingBody["items"],
  options: {
    branchId: string;
    customerGender: string;
    staff: boolean;
    excludeBookingId?: string;
    additionalLockKeys?: string[];
    travel?: BookingTravelPolicy;
  },
): Promise<{
  slots: ServiceSlotCheck[];
  travelBlocks: EmployeeTravelBlock[];
  lease: SlotLockLease;
}> => {
  const now = new Date();
  const preflight = await checkSlots(inputs, { ...options, now });
  const preflightTravelBlocks = buildEmployeeTravelBlocks(
    preflight,
    options.travel ?? {
      travelMinutesBefore: 0,
      travelMinutesAfter: 0,
    },
  );
  ensureSlotsAvailable(preflight, preflightTravelBlocks);
  await assertEmployeeTravelAvailability({
    branchId: options.branchId,
    blocks: preflightTravelBlocks,
    excludeBookingId: options.excludeBookingId,
    now,
  });
  const expectedKeys = new Set([
    ...slotLockKeys(options.branchId, preflight),
    ...travelBlockLockKeys(options.branchId, preflightTravelBlocks),
    ...(options.additionalLockKeys ?? []),
  ]);
  const lockTtlMs = BOOKING_CONFIG_LEASE_TTL_MS;
  const configLease = await redisService.acquireReadWriteLease(
    bookingConfigLeaseScope(options.branchId),
    "read",
    lockTtlMs,
  );
  if (!configLease) {
    throw ApiError.conflict(
      "Booking configuration is currently being updated",
      "BOOKING_CONFIGURATION_LOCKED",
    );
  }
  const locks = await redisService.acquireLocks([...expectedKeys], lockTtlMs);
  if (!locks) {
    await redisService.releaseReadWriteLease(configLease);
    throw ApiError.conflict(
      "The selected slot is currently being reserved",
      "BOOKING_SLOT_LOCKED",
    );
  }
  const lease = createSlotLockLease(locks, configLease, lockTtlMs);
  try {
    const checked = await checkSlots(inputs, {
      ...options,
      now: new Date(),
    });
    const checkedTravelBlocks = buildEmployeeTravelBlocks(
      checked,
      options.travel ?? {
        travelMinutesBefore: 0,
        travelMinutesAfter: 0,
      },
    );
    ensureSlotsAvailable(checked, checkedTravelBlocks);
    const changedAssignment = [
      ...slotLockKeys(options.branchId, checked),
      ...travelBlockLockKeys(options.branchId, checkedTravelBlocks),
    ].some((key) => !expectedKeys.has(key));
    if (changedAssignment) {
      throw ApiError.conflict(
        "Resource allocation changed; check availability and try again",
        "BOOKING_RESOURCE_CHANGED",
      );
    }
    await assertEmployeeTravelAvailability({
      branchId: options.branchId,
      blocks: checkedTravelBlocks,
      excludeBookingId: options.excludeBookingId,
      now: new Date(),
    });
    await lease.assertValid();
    return {
      slots: checked,
      travelBlocks: checkedTravelBlocks,
      lease,
    };
  } catch (error) {
    await lease.release();
    throw error;
  }
};

const priceEstimate = (price: IPricePresentation): number => {
  if (price.mode === "fixed") return price.amountMinor ?? 0;
  if (price.mode === "starting_from" || price.mode === "range") {
    return price.fromAmountMinor ?? 0;
  }
  return 0;
};

const calculateAdvance = (
  policy: IAdvancePolicy,
  estimate: number,
): number => {
  if (policy.requirement === "none") return 0;
  if (policy.basis === "accepted_quote") {
    throw ApiError.conflict(
      "This service requires a quote before its advance can be calculated",
      "ADVANCE_REQUIRES_QUOTE",
    );
  }
  if (policy.calculation === "fixed") {
    return policy.fixedAmountMinor ?? 0;
  }
  if (policy.calculation === "percentage") {
    return Math.min(
      Math.ceil((estimate * (policy.percentage ?? 0)) / 100),
      estimate,
    );
  }
  return 0;
};

const effectiveAdvance = (
  item: ResolvedBookingItem,
  settings: BookingSettingsSnapshot,
): IAdvancePolicy =>
  item.branchAdvancePolicy ??
  item.service.advancePolicy ??
  settings.defaultAdvance;

const combinePricing = (
  resolvedItems: ResolvedBookingItem[],
  settings: BookingSettingsSnapshot,
  overrides?: {
    quotedTotalMinor?: number;
    requirement?: AdvanceRequirement;
    due?: number;
  },
) => {
  const prices = resolvedItems.map((item) => item.slot.price);
  const currencies = new Set(prices.map((price) => price.currency));
  if (currencies.size !== 1) {
    throw ApiError.conflict(
      "All booking items must use the same currency",
      "BOOKING_CURRENCY_MISMATCH",
    );
  }
  const currency = prices[0]?.currency;
  if (!currency) {
    throw ApiError.badRequest(
      "A booking requires at least one priced item",
      undefined,
      "BOOKING_ITEMS_REQUIRED",
    );
  }

  const estimatedSubtotalMinor =
    overrides?.quotedTotalMinor ??
    prices.reduce((sum, price) => sum + priceEstimate(price), 0);
  let mode: PriceMode;
  if (overrides?.quotedTotalMinor !== undefined) mode = "quote_required";
  else if (prices.every((price) => price.mode === "fixed")) mode = "fixed";
  else if (prices.some((price) => price.mode === "starting_from")) mode = "starting_from";
  else mode = "range";

  const policies = resolvedItems.map((item) => effectiveAdvance(item, settings));
  const requirement =
    overrides?.requirement ??
    (policies.some((policy) => policy.requirement === "required")
      ? "required"
      : policies.some((policy) => policy.requirement === "optional")
        ? "optional"
        : "none");
  const advanceDueMinor =
    overrides?.due ??
    policies.reduce(
      (sum, policy, index) =>
        sum + calculateAdvance(policy, priceEstimate(prices[index])),
      0,
    );

  return {
    mode,
    currency,
    estimatedSubtotalMinor,
    requirement,
    advanceDueMinor,
    snapshot: {
      currency,
      mode,
      ...(mode === "fixed"
        ? { displayAmountMinor: estimatedSubtotalMinor }
        : mode === "starting_from"
          ? { displayFromMinor: estimatedSubtotalMinor }
          : mode === "range"
            ? {
                displayFromMinor: estimatedSubtotalMinor,
                displayToMinor: prices.reduce(
                  (sum, price) =>
                    sum +
                    (price.mode === "fixed"
                      ? (price.amountMinor ?? 0)
                      : (price.toAmountMinor ?? price.fromAmountMinor ?? 0)),
                  0,
                ),
              }
            : {
                quotedSubtotalMinor: overrides?.quotedTotalMinor,
              }),
      estimatedSubtotalMinor,
      ...(overrides?.quotedTotalMinor !== undefined
        ? { quotedSubtotalMinor: overrides.quotedTotalMinor }
        : {}),
      advanceRequirement: requirement,
      advanceDueMinor,
      advancePaidMinor: 0,
      ...(mode !== "fixed"
        ? { customerAcceptedVariablePricingAt: new Date() }
        : {}),
    },
  };
};

const buildBookedPhases = (
  slot: ServiceSlotCheck,
  travelBlocks: readonly EmployeeTravelBlock[] = [],
) => {
  const blocking = new Set(slot.phases.map((phase) => phase.phaseKey));
  let cursor = slot.startAt.getTime();
  const result: Array<{
    key: string;
    type: "application" | "processing" | "finishing" | "buffer" | "travel";
    startAt: Date;
    endAt: Date;
    blocksEmployee: boolean;
    blocksBranch: boolean;
  }> = [];
  const add = (
    key: "application" | "processing" | "finishing" | "buffer",
    minutes: number,
  ): void => {
    const startAt = new Date(cursor);
    cursor += minutes * 60_000;
    if (minutes > 0) {
      result.push({
        key,
        type: key,
        startAt,
        endAt: new Date(cursor),
        blocksEmployee: blocking.has(key),
        blocksBranch: false,
      });
    }
  };
  add("application", slot.duration.applicationMinutes);
  add("processing", slot.duration.processingMinutes);
  add("finishing", slot.duration.finishingMinutes);
  add("buffer", slot.duration.bufferMinutes);
  result.push(
    ...travelBlocks.map((block) => ({
      key: block.phaseKey,
      type: "travel" as const,
      startAt: block.startAt,
      endAt: block.endAt,
      blocksEmployee: true,
      blocksBranch: false,
    })),
  );
  return result.sort(
    (left, right) =>
      left.startAt.getTime() - right.startAt.getTime() ||
      left.endAt.getTime() - right.endAt.getTime() ||
      left.key.localeCompare(right.key),
  );
};

const createResolvedAggregate = async (
  input: CreateResolvedAggregateInput,
) => {
  const pricing = combinePricing(input.resolvedItems, input.settings, {
    quotedTotalMinor: input.quotedTotalMinor,
    requirement: input.advanceRequirementOverride,
    due: input.advanceDueOverride,
  });
  if (pricing.mode !== "fixed" && !input.customerAcceptedVariablePricing) {
    throw ApiError.badRequest(
      "Variable or quoted pricing must be explicitly accepted",
      undefined,
      "VARIABLE_PRICING_ACKNOWLEDGEMENT_REQUIRED",
    );
  }

  const now = new Date();
  const status: BookingStatus =
    pricing.requirement === "required" ? "pending_advance" : "confirmed";
  const holdExpiresAt =
    status === "pending_advance"
      ? new Date(now.getTime() + input.settings.temporaryHoldMinutes * 60_000)
      : undefined;
  const startAt = new Date(
    Math.min(...input.resolvedItems.map((item) => item.slot.startAt.getTime())),
  );
  const endAt = new Date(
    Math.max(...input.resolvedItems.map((item) => item.slot.endAt.getTime())),
  );
  const event = input.event ?? {
    type: "standard" as const,
    partySize: 1,
  };
  const reservationCountSnapshot = input.resolvedItems.reduce(
    (total, item) =>
      total + item.slot.phases.length + item.slot.resourceAssignments.length,
    0,
  ) + input.travelBlocks.length;

  const [booking] = await Booking.create(
    [
      {
        branchId: input.branchId,
        customerId: input.customer._id,
        employeeIds: [
          ...new Map(
            input.resolvedItems.map((item) => [
              item.employee._id.toString(),
              item.employee._id,
            ]),
          ).values(),
        ],
        ...(input.quoteId ? { quoteId: input.quoteId } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
        source: input.source,
        status,
        startAt,
        endAt,
        customerSnapshot: {
          name: input.customer.name,
          ...(input.customer.email ? { email: input.customer.email } : {}),
          ...(input.customer.phone ? { phone: input.customer.phone } : {}),
        },
        pricingSnapshot: pricing.snapshot,
        externalSettlement: { status: "not_tracked" },
        includedProductSnapshots: input.includedProducts ?? [],
        reservationCountSnapshot,
        cancellationPolicySnapshot: {
          cancellationWindowHours: input.settings.cancellationWindowHours,
        },
        event: {
          type: event.type,
          ...(event.name ? { name: event.name } : {}),
          partySize: event.partySize,
          travelMinutesBefore: event.travelMinutesBefore ?? 0,
          travelMinutesAfter: event.travelMinutesAfter ?? 0,
          ...(event.offsiteAddress
            ? { offsiteAddress: event.offsiteAddress }
            : {}),
        },
        ...(input.customerNote ? { customerNote: input.customerNote } : {}),
        ...(input.internalNote ? { internalNote: input.internalNote } : {}),
        ...(holdExpiresAt ? { expiresAt: holdExpiresAt } : { confirmedAt: now }),
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
      },
    ],
    { session: input.session },
  );

  const bookingItems = input.resolvedItems.map((item, sequence) => ({
    _id: new Types.ObjectId(),
    branchId: input.branchId,
    bookingId: booking._id,
    ...(input.quoteLineIds?.[sequence]
      ? { quoteLineId: input.quoteLineIds[sequence] }
      : {}),
    sequence,
    serviceId: item.service._id,
    employeeId: item.employee._id,
    serviceSnapshot: {
      serviceId: item.service._id,
      code: item.service.code,
      name: item.service.name,
      targetClientGender: item.service.targetClientGender,
    },
    employeeSnapshot: {
      employeeId: item.employee._id,
      name: item.employee.name,
      ...(item.employee.title ? { title: item.employee.title } : {}),
    },
    phases: buildBookedPhases(
      item.slot,
      input.travelBlocks.filter((block) => block.itemIndex === sequence),
    ),
    startAt: item.slot.startAt,
    endAt: item.slot.endAt,
    priceSnapshot: {
      mode:
        input.quotedAmounts?.[sequence] !== undefined
          ? "quote_required"
          : item.slot.price.mode,
      currency: item.slot.price.currency,
      ...(item.slot.price.amountMinor !== undefined
        ? { listedAmountMinor: item.slot.price.amountMinor }
        : {}),
      ...(item.slot.price.fromAmountMinor !== undefined
        ? { listedFromMinor: item.slot.price.fromAmountMinor }
        : {}),
      ...(item.slot.price.toAmountMinor !== undefined
        ? { listedToMinor: item.slot.price.toAmountMinor }
        : {}),
      ...(input.quotedAmounts?.[sequence] !== undefined
        ? { quotedAmountMinor: input.quotedAmounts[sequence] }
        : { estimatedAmountMinor: priceEstimate(item.slot.price) }),
    },
    status,
  }));
  await BookingItem.insertMany(bookingItems, { session: input.session });

  const reservations = input.resolvedItems.flatMap((item, sequence) => {
    const sourceId = bookingItems[sequence]._id;
    const employeeReservations = item.slot.phases.map((phase) => ({
      branchId: input.branchId,
      resourceType: "employee" as const,
      resourceId: item.employee._id,
      sourceType: "booking_item" as const,
      sourceId,
      bookingId: booking._id,
      phaseKey: phase.phaseKey,
      startAt: phase.startAt,
      endAt: phase.endAt,
      units: phase.units,
      status: status === "pending_advance" ? ("held" as const) : ("confirmed" as const),
      ...(holdExpiresAt ? { holdExpiresAt } : {}),
    }));
    const travelReservations = input.travelBlocks
      .filter((block) => block.itemIndex === sequence)
      .map((block) => ({
        branchId: input.branchId,
        resourceType: "employee" as const,
        resourceId: item.employee._id,
        sourceType: "booking_item" as const,
        sourceId,
        bookingId: booking._id,
        phaseKey: block.phaseKey,
        startAt: block.startAt,
        endAt: block.endAt,
        units: block.reservationUnits,
        status:
          status === "pending_advance"
            ? ("held" as const)
            : ("confirmed" as const),
        ...(holdExpiresAt ? { holdExpiresAt } : {}),
      }));
    const resources = item.slot.resourceAssignments.map((resource) => ({
      branchId: input.branchId,
      resourceType: resource.resourceType,
      resourceId: new Types.ObjectId(resource.resourceId),
      sourceType: "booking_item" as const,
      sourceId,
      bookingId: booking._id,
      phaseKey: resource.phaseKey,
      startAt: resource.startAt,
      endAt: resource.endAt,
      units: resource.units,
      status: status === "pending_advance" ? ("held" as const) : ("confirmed" as const),
      ...(holdExpiresAt ? { holdExpiresAt } : {}),
    }));
    return [...employeeReservations, ...travelReservations, ...resources];
  });
  if (reservations.length > 0) {
    await CalendarReservation.insertMany(reservations, { session: input.session });
  }
  await addOutbox(
    booking._id,
    "booking.created",
    {
      bookingId: booking.id,
      reference: booking.reference,
      branchId: input.branchId,
      customerId: input.customer._id.toString(),
      status,
      startAt: booking.startAt.toISOString(),
      endAt: booking.endAt.toISOString(),
    },
    input.session,
  );
  return { booking, items: bookingItems };
};

const publicBookingAggregate = (
  booking: Record<string, unknown>,
  items: unknown[],
  customer: boolean,
) => {
  const value = { ...booking };
  delete value.idempotencyKey;
  delete value.__v;
  if (customer) {
    delete value.internalNote;
    delete value.createdByUserId;
    delete value.updatedByUserId;
    delete value.reservationCountSnapshot;
    delete value.employeeIds;
    const external = value.externalSettlement as
      | Record<string, unknown>
      | undefined;
    if (external) {
      value.externalSettlement = {
        status: external.status,
        externallyReportedFinalAmountMinor:
          external.externallyReportedFinalAmountMinor,
        settledAt: external.settledAt,
      };
    }
  }
  return {
    ...value,
    items,
    holdExpired:
      value.status === "pending_advance" &&
      value.expiresAt instanceof Date &&
      value.expiresAt <= new Date(),
  };
};

const findIdempotentBooking = async (
  base: string,
  stored: string,
) => {
  const booking = await Booking.findOne({
    idempotencyKey: { $regex: `^${base}:` },
  }).select("+idempotencyKey");
  if (!booking) return null;
  if (booking.idempotencyKey !== stored) {
    throw ApiError.conflict(
      "This Idempotency-Key was already used with a different request",
      "IDEMPOTENCY_KEY_REUSED",
    );
  }
  const aggregate = await bookingRepository.loadAggregate(booking._id);
  if (!aggregate) return null;
  return publicBookingAggregate(
    aggregate.booking.toObject() as unknown as Record<string, unknown>,
    aggregate.items.map((item) => item.toObject()),
    true,
  );
};

const create = async (
  input: CreateBookingBody,
  rawIdempotencyKey: string | undefined,
  context: BookingRequestContext,
) => {
  const customer = await requireCustomerForActor(context.actor, input.customerId);
  assertActorCanAccessBranch(context.actor, input.branchId);
  const effectiveEvent: NonNullable<CreateBookingBody["event"]> =
    input.event ?? {
      type: "standard",
      partySize: 1,
      travelMinutesBefore: 0,
      travelMinutesAfter: 0,
    };
  const idempotencyKey = requireIdempotencyKey(rawIdempotencyKey);
  const fingerprint = hash(
    JSON.stringify({
      branchId: input.branchId,
      customerId: customer.id,
      items: input.items.map((item) => ({
        ...item,
        startAt: item.startAt.toISOString(),
      })),
      waitlistEntryId: input.waitlistEntryId,
      customerAcceptedVariablePricing:
        input.customerAcceptedVariablePricing === true,
      customerNote: input.customerNote ?? null,
      internalNote:
        context.actor.role === "customer" ? null : (input.internalNote ?? null),
      source:
        context.actor.role === "customer"
          ? "online"
          : (input.source ?? "admin"),
      event: effectiveEvent,
    }),
  );
  const idempotency = makeIdempotencyKey(
    customer.id,
    "booking:create",
    idempotencyKey,
    fingerprint,
  );
  const existing = await findIdempotentBooking(
    idempotency.base,
    idempotency.stored,
  );
  if (existing) return { aggregate: existing, replayed: true };

  const locked = await lockAndRecheckSlots(input.items, {
    branchId: input.branchId,
    customerGender: customer.gender,
    staff: context.actor.role !== "customer",
    travel: {
      travelMinutesBefore: effectiveEvent.travelMinutesBefore,
      travelMinutesAfter: effectiveEvent.travelMinutesAfter,
    },
  });
  try {
    const [settings, resolvedItems] = await Promise.all([
      getSettings(),
      loadResolvedItemMetadata(input.branchId, locked.slots),
    ]);
    if (
      resolvedItems.some((item) => item.slot.price.mode === "quote_required")
    ) {
      throw ApiError.conflict(
        "A quote-required service must be booked by accepting a valid quote",
        "BOOKING_QUOTE_REQUIRED",
      );
    }
    if (
      context.actor.role === "customer" &&
      resolvedItems.some((item) => item.service.bookingMode !== "instant")
    ) {
      throw ApiError.conflict(
        "One or more services require staff review before booking",
        "BOOKING_REVIEW_REQUIRED",
      );
    }
    const aggregate = await withTransaction(async (session) => {
      await locked.lease.assertValid();
      const duplicate = await Booking.findOne({
        idempotencyKey: { $regex: `^${idempotency.base}:` },
      })
        .select("+idempotencyKey")
        .session(session);
      if (duplicate) {
        if (duplicate.idempotencyKey !== idempotency.stored) {
          throw ApiError.conflict(
            "This Idempotency-Key was already used with a different request",
            "IDEMPOTENCY_KEY_REUSED",
          );
        }
        const loaded = await bookingRepository.loadAggregate(duplicate._id, {
          session,
        });
        if (!loaded) {
          throw ApiError.conflict("Idempotent booking could not be loaded");
        }
        await locked.lease.assertValid();
        return {
          booking: loaded.booking,
          items: loaded.items.map((item) => item.toObject()),
        };
      }

      if (input.waitlistEntryId) {
        const waitlistEntry = await WaitlistEntry.findOne({
          _id: input.waitlistEntryId,
          customerId: customer._id,
          branchId: input.branchId,
          status: { $in: ["waiting", "offered"] },
        }).session(session);
        if (
          !waitlistEntry ||
          (waitlistEntry.status === "offered" &&
            (!waitlistEntry.offeredUntil ||
              waitlistEntry.offeredUntil <= new Date()))
        ) {
          throw ApiError.conflict(
            "Waitlist entry is no longer valid",
            "WAITLIST_ENTRY_INVALID",
          );
        }
        const requestedServices = new Set(input.items.map((item) => item.serviceId));
        if (
          waitlistEntry.serviceIds.some(
            (serviceId) => !requestedServices.has(serviceId.toString()),
          )
        ) {
          throw ApiError.badRequest(
            "Booking does not cover the waitlisted services",
            undefined,
            "WAITLIST_SERVICE_MISMATCH",
          );
        }
      }

      const created = await createResolvedAggregate({
        branchId: input.branchId,
        customer,
        resolvedItems,
        travelBlocks: locked.travelBlocks,
        settings,
        actorUserId: context.actor.userId,
        source:
          context.actor.role === "customer"
            ? "online"
            : (input.source ?? "admin"),
        idempotencyKey: idempotency.stored,
        customerAcceptedVariablePricing:
          input.customerAcceptedVariablePricing === true,
        customerNote: input.customerNote,
        internalNote:
          context.actor.role === "customer" ? undefined : input.internalNote,
        event: {
          type: effectiveEvent.type,
          name: effectiveEvent.name,
          partySize: effectiveEvent.partySize,
          offsiteAddress: effectiveEvent.offsiteAddress,
          travelMinutesBefore: effectiveEvent.travelMinutesBefore,
          travelMinutesAfter: effectiveEvent.travelMinutesAfter,
        },
        session,
      });
      if (input.waitlistEntryId) {
        const entry = await WaitlistEntry.findById(input.waitlistEntryId).session(session);
        if (entry) {
          entry.status = "booked";
          entry.bookingId = created.booking._id;
          entry.offeredUntil = undefined;
          await entry.save({ session });
        }
      }
      await recordAudit(
        {
          context: context.audit,
          action: "booking.created",
          entityType: "Booking",
          entityId: created.booking._id,
        },
        session,
      );
      await locked.lease.assertValid();
      return created;
    });
    return {
      aggregate: publicBookingAggregate(
        aggregate.booking.toObject() as unknown as Record<string, unknown>,
        aggregate.items,
        context.actor.role === "customer",
      ),
      replayed: false,
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11_000
    ) {
      const replay = await findIdempotentBooking(
        idempotency.base,
        idempotency.stored,
      );
      if (replay) return { aggregate: replay, replayed: true };
    }
    throw error;
  } finally {
    await locked.lease.release();
  }
};

const list = async (
  query: BookingListQuery,
  context: BookingRequestContext,
) => {
  const pagination = parsePagination(query);
  const filter: QueryFilter<IBooking> = {};
  if (context.actor.role === "customer") {
    const customer = await requireCustomerForActor(context.actor);
    filter.customerId = customer._id;
  } else {
    scopeBookingFilter(filter, requireStaffScope(context.actor));
    if (query.customerId) filter.customerId = query.customerId;
  }
  if (query.branchId) {
    assertActorCanAccessBranch(context.actor, query.branchId);
    filter.branchId = query.branchId;
  }
  if (query.status) filter.status = query.status;
  if (query.employeeId && context.actor.role !== "customer") {
    filter.employeeIds = query.employeeId;
  }
  if (query.from || query.to) {
    filter.startAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lt: query.to } : {}),
    };
  }
  const customerView = context.actor.role === "customer";
  const [bookings, total] = await Promise.all([
    Booking.find(filter)
      .select(customerView ? "-internalNote" : "+internalNote")
      .sort(parseSort(query.sort, ["createdAt", "updatedAt", "startAt", "reference"], "-startAt"))
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);
  let itemsByBooking = new Map<string, unknown[]>();
  if (query.includeItems && bookings.length > 0) {
    const items = await BookingItem.find({
      bookingId: { $in: bookings.map((booking) => booking._id) },
    })
      .sort({ bookingId: 1, sequence: 1 })
      .lean();
    itemsByBooking = new Map();
    for (const item of items) {
      const key = item.bookingId.toString();
      itemsByBooking.set(key, [...(itemsByBooking.get(key) ?? []), item]);
    }
  }
  return {
    items: bookings.map((booking) =>
      publicBookingAggregate(
        booking as unknown as Record<string, unknown>,
        itemsByBooking.get(booking._id.toString()) ?? [],
        customerView,
      ),
    ),
    pagination: buildPaginationMeta(total, pagination),
  };
};

const get = async (
  bookingId: string,
  context: BookingRequestContext,
) => {
  const customerView = context.actor.role === "customer";
  const aggregate = await bookingRepository.loadAggregate(bookingId, {
    includePrivate: !customerView,
  });
  if (!aggregate) throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
  if (customerView) {
    const customer = await requireCustomerForActor(context.actor);
    if (!aggregate.booking.customerId.equals(customer._id)) {
      throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
    }
  } else {
    assertActorCanAccessBranch(context.actor, aggregate.booking.branchId.toString());
  }
  return publicBookingAggregate(
    aggregate.booking.toObject() as unknown as Record<string, unknown>,
    aggregate.items.map((item) => item.toObject()),
    customerView,
  );
};

const employeeWorkView = (
  booking: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
) => ({
  id: booking._id,
  reference: booking.reference,
  branchId: booking.branchId,
  status: booking.status,
  startAt: booking.startAt,
  endAt: booking.endAt,
  customer: booking.customerSnapshot,
  event: booking.event,
  customerNote: booking.customerNote,
  cancellationReason: booking.cancellationReason,
  confirmedAt: booking.confirmedAt,
  checkedInAt: booking.checkedInAt,
  completedAt: booking.completedAt,
  cancelledAt: booking.cancelledAt,
  items: items.map((item) => ({
    id: item._id,
    sequence: item.sequence,
    serviceId: item.serviceId,
    service: item.serviceSnapshot,
    startAt: item.startAt,
    endAt: item.endAt,
    phases: item.phases,
    status: item.status,
  })),
});

const listMyEmployeeBookings = async (
  query: EmployeeBookingListQuery,
  context: BookingRequestContext,
) => {
  if (context.actor.role !== "employee") {
    throw ApiError.forbidden(
      "An employee account is required",
      "EMPLOYEE_ACCOUNT_REQUIRED",
    );
  }
  const scope = requireStaffScope(context.actor);
  const employee = await Employee.findOne({
    userId: context.actor.userId,
    status: { $in: ["active", "on_leave"] },
  }).select("_id");
  if (!employee) {
    throw ApiError.notFound("Employee profile was not found", "EMPLOYEE_NOT_FOUND");
  }
  const pagination = parsePagination(query);
  const bookingFilter: QueryFilter<IBooking> = {
    employeeIds: employee._id,
  };
  if (query.status) bookingFilter.status = query.status;
  if (query.from || query.to) {
    bookingFilter.startAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lt: query.to } : {}),
    };
  }
  scopeBookingFilter(bookingFilter, scope);
  const [bookings, total] = await Promise.all([
    Booking.find(bookingFilter)
      .select(
        "branchId reference status startAt endAt customerSnapshot event customerNote cancellationReason confirmedAt checkedInAt completedAt cancelledAt",
      )
      .sort(parseSort(query.sort, ["startAt", "createdAt", "updatedAt"], "startAt"))
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    Booking.countDocuments(bookingFilter),
  ]);
  const assignedItems = await BookingItem.find({
    bookingId: { $in: bookings.map((booking) => booking._id) },
    employeeId: employee._id,
  })
    .select(
      "bookingId sequence serviceId serviceSnapshot startAt endAt phases status",
    )
    .sort({ bookingId: 1, sequence: 1 })
    .lean();
  const itemMap = new Map<string, Array<Record<string, unknown>>>();
  for (const item of assignedItems) {
    const key = item.bookingId.toString();
    itemMap.set(key, [
      ...(itemMap.get(key) ?? []),
      item as unknown as Record<string, unknown>,
    ]);
  }
  return {
    items: bookings.map((booking) =>
      employeeWorkView(
        booking as unknown as Record<string, unknown>,
        itemMap.get(booking._id.toString()) ?? [],
      ),
    ),
    pagination: buildPaginationMeta(total, pagination),
  };
};

const getMyEmployeeBooking = async (
  bookingId: string,
  context: BookingRequestContext,
) => {
  if (context.actor.role !== "employee") {
    throw ApiError.forbidden(
      "An employee account is required",
      "EMPLOYEE_ACCOUNT_REQUIRED",
    );
  }
  const scope = requireStaffScope(context.actor);
  const employee = await Employee.findOne({
    userId: context.actor.userId,
    status: { $in: ["active", "on_leave"] },
  }).select("_id");
  if (!employee) {
    throw ApiError.notFound("Employee profile was not found", "EMPLOYEE_NOT_FOUND");
  }
  const [booking, items] = await Promise.all([
    Booking.findById(bookingId)
      .select(
        "branchId reference status startAt endAt customerSnapshot event customerNote cancellationReason confirmedAt checkedInAt completedAt cancelledAt",
      )
      .lean(),
    BookingItem.find({ bookingId, employeeId: employee._id })
      .select(
        "bookingId sequence serviceId serviceSnapshot startAt endAt phases status",
      )
      .sort({ sequence: 1 })
      .lean(),
  ]);
  if (!booking || items.length === 0) {
    throw ApiError.notFound("Assigned booking was not found", "BOOKING_NOT_FOUND");
  }
  if (!scope.allBranches && !scope.branchIds.includes(booking.branchId.toString())) {
    throw ApiError.notFound("Assigned booking was not found", "BOOKING_NOT_FOUND");
  }
  return employeeWorkView(
    booking as unknown as Record<string, unknown>,
    items as unknown as Array<Record<string, unknown>>,
  );
};

const assertCancellationPolicy = (
  booking: InstanceType<typeof Booking>,
  overridePolicy: boolean,
  customer: boolean,
): void => {
  const cutoff = new Date(
    booking.startAt.getTime() -
      booking.cancellationPolicySnapshot.cancellationWindowHours * 3_600_000,
  );
  if (new Date() >= cutoff && (customer || !overridePolicy)) {
    throw ApiError.conflict(
      "The booking is inside its cancellation window",
      {
        cancellationWindowHours:
          booking.cancellationPolicySnapshot.cancellationWindowHours,
        cutoff,
      },
      "CANCELLATION_WINDOW_CLOSED",
    );
  }
};

const cancel = async (
  bookingId: string,
  input: CancelBookingBody,
  context: BookingRequestContext,
) =>
  withTransaction(async (session) => {
    const booking = await Booking.findById(bookingId).session(session);
    if (!booking) throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
    const customerView = context.actor.role === "customer";
    if (customerView) {
      const customer = await requireCustomerForActor(context.actor);
      if (!booking.customerId.equals(customer._id)) {
        throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
      }
    } else {
      assertActorCanAccessBranch(context.actor, booking.branchId.toString());
    }
    if (
      !(
        customerView
          ? ["requested", "pending_advance", "confirmed"].includes(booking.status)
          : ACTIVE_STATUSES.includes(booking.status)
      )
    ) {
      throw ApiError.conflict("Booking cannot be cancelled", "BOOKING_NOT_CANCELLABLE");
    }
    assertCancellationPolicy(booking, input.overridePolicy, customerView);
    booking.status = "cancelled";
    booking.cancelledAt = new Date();
    booking.cancellationReason = input.reason;
    booking.updatedByUserId = new Types.ObjectId(context.actor.userId);
    await booking.save({ session });
    await Promise.all([
      releaseBookingReservations(booking._id, session),
      setBookingItemsStatus(booking._id, "cancelled", session),
    ]);
    await addOutbox(
      booking._id,
      "booking.cancelled",
      {
        bookingId: booking.id,
        reference: booking.reference,
        customerId: booking.customerId.toString(),
        branchId: booking.branchId.toString(),
        reason: input.reason,
      },
      session,
    );
    await recordAudit(
      {
        context: context.audit,
        action: "booking.cancelled",
        entityType: "Booking",
        entityId: booking._id,
        changes: { reason: input.reason },
      },
      session,
    );
    return { id: booking.id, reference: booking.reference, status: booking.status };
  });

const reschedule = async (
  bookingId: string,
  input: RescheduleBookingBody,
  context: BookingRequestContext,
) => {
  const aggregate = await bookingRepository.loadAggregate(bookingId);
  if (!aggregate) throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
  const customerView = context.actor.role === "customer";
  const customer = await requireCustomerForActor(
    context.actor,
    customerView ? undefined : aggregate.booking.customerId.toString(),
  );
  if (customerView && !aggregate.booking.customerId.equals(customer._id)) {
    throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
  }
  if (!customerView) {
    assertActorCanAccessBranch(context.actor, aggregate.booking.branchId.toString());
  }
  if (!["pending_advance", "confirmed"].includes(aggregate.booking.status)) {
    throw ApiError.conflict(
      "Only pending or confirmed bookings can be rescheduled",
      "BOOKING_NOT_RESCHEDULABLE",
    );
  }
  if (
    aggregate.booking.status === "pending_advance" &&
    (!aggregate.booking.expiresAt || aggregate.booking.expiresAt <= new Date())
  ) {
    throw ApiError.conflict("Booking hold has expired", "BOOKING_HOLD_EXPIRED");
  }
  assertCancellationPolicy(aggregate.booking, input.overridePolicy, customerView);
  assertRescheduleAssignmentsAllowed(
    aggregate.items,
    input.items,
    customerView,
  );
  const existingReservations = await CalendarReservation.find({
    bookingId: aggregate.booking._id,
    status: { $ne: "released" },
  })
    .select("resourceType resourceId startAt endAt")
    .lean();
  const locked = await lockAndRecheckSlots(input.items, {
    branchId: aggregate.booking.branchId.toString(),
    customerGender: customer.gender,
    staff: !customerView,
    excludeBookingId: aggregate.booking.id,
    travel: {
      travelMinutesBefore: aggregate.booking.event.travelMinutesBefore,
      travelMinutesAfter: aggregate.booking.event.travelMinutesAfter,
    },
    additionalLockKeys: existingReservations.flatMap((reservation) =>
      intervalLockDates(reservation.startAt, reservation.endAt).flatMap(
        (date) => [
          `booking:${reservation.resourceType}:${reservation.resourceId.toString()}:${date}`,
          `booking:branch:${aggregate.booking.branchId.toString()}:${date}`,
        ],
      ),
    ),
  });
  try {
    const resolvedItems = await loadResolvedItemMetadata(
      aggregate.booking.branchId.toString(),
      locked.slots,
    );
    return await withTransaction(async (session) => {
      await locked.lease.assertValid();
      const booking = await Booking.findById(bookingId).session(session);
      const items = await BookingItem.find({ bookingId })
        .sort({ sequence: 1 })
        .session(session);
      if (!booking || items.length !== input.items.length) {
        throw ApiError.conflict(
          "Booking changed while it was being rescheduled",
          "BOOKING_CHANGED",
        );
      }
      if (!["pending_advance", "confirmed"].includes(booking.status)) {
        throw ApiError.conflict(
          "Booking status changed while it was being rescheduled",
          "BOOKING_CHANGED",
        );
      }
      items.forEach((item, sequence) => {
        const requested = input.items[sequence];
        const originallyLoaded = aggregate.items[sequence];
        if (
          !requested ||
          !originallyLoaded ||
          !item.serviceId.equals(originallyLoaded.serviceId) ||
          !item.employeeId.equals(originallyLoaded.employeeId) ||
          item.startAt.getTime() !== originallyLoaded.startAt.getTime() ||
          item.endAt.getTime() !== originallyLoaded.endAt.getTime() ||
          !item.serviceId.equals(requested.serviceId) ||
          (customerView && !item.employeeId.equals(requested.employeeId))
        ) {
          throw ApiError.conflict(
            "Booking assignments changed while it was being rescheduled",
            "BOOKING_CHANGED",
          );
        }
      });

      await CalendarReservation.deleteMany({ bookingId: booking._id }).session(session);
      const reservationStatus =
        booking.status === "pending_advance" ? "held" : "confirmed";
      const newReservations: Array<Record<string, unknown>> = [];
      const assignmentChanges: Array<{
        sequence: number;
        fromEmployeeId: string;
        toEmployeeId: string;
      }> = [];
      for (const [sequence, item] of items.entries()) {
        const slot = locked.slots[sequence];
        const resolved = resolvedItems[sequence];
        const previousEmployeeId = item.employeeId.toString();
        item.startAt = slot.startAt;
        item.endAt = slot.endAt;
        item.employeeId = resolved.employee._id;
        item.employeeSnapshot = {
          employeeId: resolved.employee._id,
          name: resolved.employee.name,
          ...(resolved.employee.title
            ? { title: resolved.employee.title }
            : {}),
        };
        item.phases = buildBookedPhases(
          slot,
          locked.travelBlocks.filter(
            (block) => block.itemIndex === sequence,
          ),
        );
        if (previousEmployeeId !== resolved.employee._id.toString()) {
          assignmentChanges.push({
            sequence,
            fromEmployeeId: previousEmployeeId,
            toEmployeeId: resolved.employee._id.toString(),
          });
        }
        await item.save({ session });
        for (const phase of slot.phases) {
          newReservations.push({
            branchId: booking.branchId,
            resourceType: "employee",
            resourceId: item.employeeId,
            sourceType: "booking_item",
            sourceId: item._id,
            bookingId: booking._id,
            phaseKey: phase.phaseKey,
            startAt: phase.startAt,
            endAt: phase.endAt,
            units: phase.units,
            status: reservationStatus,
            ...(reservationStatus === "held"
              ? { holdExpiresAt: booking.expiresAt }
              : {}),
          });
        }
        for (const travel of locked.travelBlocks.filter(
          (block) => block.itemIndex === sequence,
        )) {
          newReservations.push({
            branchId: booking.branchId,
            resourceType: "employee",
            resourceId: item.employeeId,
            sourceType: "booking_item",
            sourceId: item._id,
            bookingId: booking._id,
            phaseKey: travel.phaseKey,
            startAt: travel.startAt,
            endAt: travel.endAt,
            units: travel.reservationUnits,
            status: reservationStatus,
            ...(reservationStatus === "held"
              ? { holdExpiresAt: booking.expiresAt }
              : {}),
          });
        }
        for (const resource of slot.resourceAssignments) {
          newReservations.push({
            branchId: booking.branchId,
            resourceType: resource.resourceType,
            resourceId: resource.resourceId,
            sourceType: "booking_item",
            sourceId: item._id,
            bookingId: booking._id,
            phaseKey: resource.phaseKey,
            startAt: resource.startAt,
            endAt: resource.endAt,
            units: resource.units,
            status: reservationStatus,
            ...(reservationStatus === "held"
              ? { holdExpiresAt: booking.expiresAt }
              : {}),
          });
        }
      }
      if (newReservations.length > 0) {
        await CalendarReservation.insertMany(newReservations, { session });
      }
      booking.startAt = new Date(
        Math.min(...locked.slots.map((slot) => slot.startAt.getTime())),
      );
      booking.endAt = new Date(
        Math.max(...locked.slots.map((slot) => slot.endAt.getTime())),
      );
      booking.employeeIds = [
        ...new Map(
          resolvedItems.map((item) => [
            item.employee._id.toString(),
            item.employee._id,
          ]),
        ).values(),
      ];
      booking.updatedByUserId = new Types.ObjectId(context.actor.userId);
      booking.reservationCountSnapshot = newReservations.length;
      await booking.save({ session });
      await addOutbox(
        booking._id,
        "booking.rescheduled",
        {
          bookingId: booking.id,
          reference: booking.reference,
          branchId: booking.branchId.toString(),
          customerId: booking.customerId.toString(),
          startAt: booking.startAt.toISOString(),
          endAt: booking.endAt.toISOString(),
        },
        session,
      );
      await recordAudit(
        {
          context: context.audit,
          action: "booking.rescheduled",
          entityType: "Booking",
          entityId: booking._id,
          ...(
            input.reason || assignmentChanges.length > 0
              ? {
                  changes: {
                    ...(input.reason ? { reason: input.reason } : {}),
                    ...(assignmentChanges.length > 0
                      ? { employeeAssignments: assignmentChanges }
                      : {}),
                  },
                }
              : {}
          ),
        },
        session,
      );
      await locked.lease.assertValid();
      return publicBookingAggregate(
        booking.toObject() as unknown as Record<string, unknown>,
        items.map((item) => item.toObject()),
        customerView,
      );
    });
  } finally {
    await locked.lease.release();
  }
};

const transition = async (
  bookingId: string,
  input: TransitionBookingBody,
  context: BookingRequestContext,
) => {
  requireStaffScope(context.actor);
  return withTransaction(async (session) => {
    const booking = await Booking.findById(bookingId).session(session);
    if (!booking) throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
    assertActorCanAccessBranch(context.actor, booking.branchId.toString());
    if (!BOOKING_TRANSITIONS[booking.status].includes(input.status)) {
      throw ApiError.conflict(
        `Booking cannot transition from ${booking.status} to ${input.status}`,
        {
          currentStatus: booking.status,
          allowedStatuses: BOOKING_TRANSITIONS[booking.status],
        },
        "BOOKING_TRANSITION_INVALID",
      );
    }
    const previousStatus = booking.status;
    if (input.status === "confirmed") {
      if (
        booking.status === "pending_advance" &&
        booking.pricingSnapshot.advancePaidMinor <
          booking.pricingSnapshot.advanceDueMinor
      ) {
        throw ApiError.conflict(
          "Required advance has not been fully recorded",
          "BOOKING_ADVANCE_UNPAID",
        );
      }
      if (booking.status === "pending_advance") {
        const liveHoldCount = await CalendarReservation.countDocuments({
          bookingId: booking._id,
          status: "held",
          holdExpiresAt: { $gt: new Date() },
        }).session(session);
        if (liveHoldCount !== booking.reservationCountSnapshot) {
          throw ApiError.conflict(
            "One or more booking reservations are no longer held",
            "BOOKING_HOLD_EXPIRED",
          );
        }
      }
      if (booking.expiresAt && booking.expiresAt <= new Date()) {
        throw ApiError.conflict("Booking hold has expired", "BOOKING_HOLD_EXPIRED");
      }
      await confirmBookingReservations(booking._id, session);
      booking.confirmedAt = new Date();
      booking.expiresAt = undefined;
    }
    if (input.status === "checked_in") booking.checkedInAt = new Date();
    if (input.status === "completed") booking.completedAt = new Date();
    if (input.status === "cancelled") {
      if (!input.reason) {
        throw ApiError.badRequest(
          "A cancellation reason is required",
          undefined,
          "CANCELLATION_REASON_REQUIRED",
        );
      }
      booking.cancelledAt = new Date();
      booking.cancellationReason = input.reason;
    }
    booking.status = input.status;
    booking.updatedByUserId = new Types.ObjectId(context.actor.userId);
    await booking.save({ session });
    await setBookingItemsStatus(booking._id, input.status, session);
    if (["completed", "cancelled", "no_show"].includes(input.status)) {
      await releaseBookingReservations(booking._id, session);
    }
    await addOutbox(
      booking._id,
      `booking.${input.status}`,
      {
        bookingId: booking.id,
        reference: booking.reference,
        branchId: booking.branchId.toString(),
        customerId: booking.customerId.toString(),
        status: input.status,
        ...(input.reason ? { reason: input.reason } : {}),
      },
      session,
    );
    await recordAudit(
      {
        context: context.audit,
        action: `booking.transition.${input.status}`,
        entityType: "Booking",
        entityId: booking._id,
        changes: { from: previousStatus, to: input.status, reason: input.reason },
      },
      session,
    );
    return { id: booking.id, reference: booking.reference, status: booking.status };
  });
};

const updateExternalSettlement = async (
  bookingId: string,
  input: ExternalSettlementBody,
  context: BookingRequestContext,
) => {
  requireStaffScope(context.actor);
  return withTransaction(async (session) => {
    const booking = await Booking.findById(bookingId).session(session);
    if (!booking) throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
    assertActorCanAccessBranch(context.actor, booking.branchId.toString());
    booking.externalSettlement.status = input.status;
    booking.externalSettlement.externalReference =
      input.externalReference ?? undefined;
    booking.externalSettlement.externallyReportedFinalAmountMinor =
      input.externallyReportedFinalAmountMinor ?? undefined;
    booking.externalSettlement.lastSyncedAt = new Date();
    booking.externalSettlement.settledAt =
      input.status === "settled_external"
        ? (input.settledAt ?? new Date())
        : undefined;
    booking.updatedByUserId = new Types.ObjectId(context.actor.userId);
    await booking.save({ session });
    await addOutbox(
      booking._id,
      "booking.external_settlement.updated",
      {
        bookingId: booking.id,
        reference: booking.reference,
        status: input.status,
      },
      session,
    );
    await recordAudit(
      {
        context: context.audit,
        action: "booking.external_settlement.updated",
        entityType: "Booking",
        entityId: booking._id,
        changes: { status: input.status },
      },
      session,
    );
    return {
      status: booking.externalSettlement.status,
      externalReference: booking.externalSettlement.externalReference,
      externallyReportedFinalAmountMinor:
        booking.externalSettlement.externallyReportedFinalAmountMinor,
      lastSyncedAt: booking.externalSettlement.lastSyncedAt,
      settledAt: booking.externalSettlement.settledAt,
    };
  });
};

export const confirmBookingAfterRequiredAdvance = async (
  bookingId: Types.ObjectId | string,
  session: ClientSession,
  paymentId?: Types.ObjectId,
): Promise<void> => {
  const booking = await Booking.findById(bookingId).session(session);
  if (!booking) throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
  if (booking.status === "confirmed") return;
  if (
    booking.status !== "pending_advance" ||
    booking.pricingSnapshot.advanceRequirement !== "required"
  ) {
    throw ApiError.conflict(
      "Booking is not awaiting a required advance",
      "BOOKING_NOT_AWAITING_ADVANCE",
    );
  }
  if (booking.expiresAt && booking.expiresAt <= new Date()) {
    throw ApiError.conflict("Booking hold has expired", "BOOKING_HOLD_EXPIRED");
  }
  if (
    booking.pricingSnapshot.advancePaidMinor <
    booking.pricingSnapshot.advanceDueMinor
  ) {
    throw ApiError.conflict(
      "Required advance has not been fully recorded",
      "BOOKING_ADVANCE_UNPAID",
    );
  }
  const heldCount = await CalendarReservation.countDocuments({
    bookingId: booking._id,
    status: "held",
    holdExpiresAt: { $gt: new Date() },
  }).session(session);
  if (heldCount !== booking.reservationCountSnapshot) {
    throw ApiError.conflict(
      "One or more booking reservations are no longer held",
      "BOOKING_HOLD_EXPIRED",
    );
  }
  await confirmBookingReservations(booking._id, session);
  await setBookingItemsStatus(booking._id, "confirmed", session);
  booking.status = "confirmed";
  booking.confirmedAt = new Date();
  booking.expiresAt = undefined;
  await booking.save({ session });
  await addOutbox(
    booking._id,
    "booking.advance_satisfied",
    {
      bookingId: booking.id,
      reference: booking.reference,
      ...(paymentId ? { paymentId: paymentId.toString() } : {}),
    },
    session,
  );
};

interface ExpireDueHoldsOptions {
  now: Date;
  limit: number;
  auditContext: AuditActorContext;
  scope?: {
    allBranches: boolean;
    branchIds: string[];
  };
  updatedByUserId?: string;
}

const expireDueHoldsCore = async ({
  now,
  limit,
  auditContext,
  scope,
  updatedByUserId,
}: ExpireDueHoldsOptions) => {
  const filter: QueryFilter<IBooking> = {
    status: "pending_advance",
    expiresAt: { $lte: now },
  };
  if (scope) scopeBookingFilter(filter, scope);
  const candidates = await Booking.find(filter).select("_id").limit(limit).lean();
  let expired = 0;
  for (const candidate of candidates) {
    const didExpire = await withTransaction(async (session) => {
      const booking = await Booking.findOne({
        _id: candidate._id,
        status: "pending_advance",
        expiresAt: { $lte: now },
      }).session(session);
      if (!booking) return false;
      booking.status = "cancelled";
      booking.cancelledAt = now;
      booking.cancellationReason = "Required advance hold expired";
      booking.updatedByUserId = updatedByUserId
        ? new Types.ObjectId(updatedByUserId)
        : undefined;
      await booking.save({ session });
      await Promise.all([
        releaseBookingReservations(booking._id, session),
        setBookingItemsStatus(booking._id, "cancelled", session),
      ]);
      await addOutbox(
        booking._id,
        "booking.hold_expired",
        {
          bookingId: booking.id,
          reference: booking.reference,
          customerId: booking.customerId.toString(),
        },
        session,
      );
      await recordAudit(
        {
          context: auditContext,
          action: "booking.hold_expired",
          entityType: "Booking",
          entityId: booking._id,
          changes: {
            previousStatus: "pending_advance",
            status: "cancelled",
            expiresAt: booking.expiresAt,
          },
        },
        session,
      );
      return true;
    });
    if (didExpire) expired += 1;
  }
  return { expired };
};

const expireDueHolds = async (
  context: BookingRequestContext,
  limit = 200,
) =>
  expireDueHoldsCore({
    now: new Date(),
    limit,
    auditContext: context.audit,
    scope: requireStaffScope(context.actor),
    updatedByUserId: context.actor.userId,
  });

export const expireDueBookingHoldsForSystem = async (
  options: {
    now?: Date;
    limit?: number;
    workerId?: string;
  } = {},
) =>
  expireDueHoldsCore({
    now: options.now ?? new Date(),
    limit: options.limit ?? 200,
    auditContext: {
      actorType: "system",
      ...(options.workerId
        ? { requestId: `booking-lifecycle:${options.workerId}` }
        : {}),
    },
  });

const acceptedQuoteResult = async (
  quoteId: string | Types.ObjectId,
) => {
  const booking = await Booking.findOne({ quoteId });
  if (booking) {
    const aggregate = await bookingRepository.loadAggregate(booking._id);
    if (!aggregate) {
      throw ApiError.conflict("Accepted quote booking could not be loaded");
    }
    return {
      quoteId: quoteId.toString(),
      inquiryStatus: "accepted" as const,
      schedulingStatus: "booking_created" as const,
      booking: publicBookingAggregate(
        aggregate.booking.toObject() as unknown as Record<string, unknown>,
        aggregate.items.map((item) => item.toObject()),
        true,
      ),
    };
  }
  return {
    quoteId: quoteId.toString(),
    inquiryStatus: "accepted" as const,
    schedulingStatus: "staff_scheduling_required" as const,
    booking: null,
    message:
      "The quote is accepted, but it does not contain one complete service/employee/time proposal. Staff must schedule the accepted inquiry.",
  };
};

const acceptQuote = async (
  quoteId: string,
  rawIdempotencyKey: string | undefined,
  context: BookingRequestContext,
) => {
  const rawKey = requireIdempotencyKey(rawIdempotencyKey);
  const customer = await requireCustomerForActor(context.actor);
  const initialQuote = await BookingQuote.findById(quoteId);
  if (!initialQuote) throw ApiError.notFound("Quote was not found", "QUOTE_NOT_FOUND");
  const initialInquiry = await BookingInquiry.findOne({
    _id: initialQuote.inquiryId,
    customerId: customer._id,
  });
  if (!initialInquiry) throw ApiError.notFound("Quote was not found", "QUOTE_NOT_FOUND");
  if (initialQuote.status === "accepted") return acceptedQuoteResult(initialQuote._id);
  if (initialQuote.status !== "sent") {
    throw ApiError.conflict("Only a sent quote can be accepted", "QUOTE_NOT_ACCEPTABLE");
  }
  if (initialQuote.validUntil <= new Date()) {
    throw ApiError.conflict("Quote has expired", "QUOTE_EXPIRED");
  }

  const fingerprint = hash(quoteId);
  const idempotency = makeIdempotencyKey(
    customer.id,
    "quote:accept",
    rawKey,
    fingerprint,
  );
  const quoteLockKey = `booking-quote:${quoteId}:accept`;
  const quoteLockToken = await redisService.acquireLock(quoteLockKey, 30_000);
  if (!quoteLockToken) {
    throw ApiError.conflict(
      "This quote is currently being accepted",
      "QUOTE_ACCEPTANCE_IN_PROGRESS",
    );
  }

  let slotLease: SlotLockLease | undefined;
  try {
    const currentQuote = await BookingQuote.findById(quoteId);
    if (!currentQuote) throw ApiError.notFound("Quote was not found", "QUOTE_NOT_FOUND");
    if (currentQuote.status === "accepted") return acceptedQuoteResult(currentQuote._id);
    if (currentQuote.status !== "sent" || currentQuote.validUntil <= new Date()) {
      throw ApiError.conflict("Quote can no longer be accepted", "QUOTE_NOT_ACCEPTABLE");
    }
    const serviceLines = currentQuote.lines.filter(
      (line) => line.type === "service",
    );
    const schedulable =
      Boolean(currentQuote.proposedStartAt) &&
      Boolean(currentQuote.proposedEndAt) &&
      serviceLines.length === 1 &&
      serviceLines[0]?.quantity === 1 &&
      serviceLines[0]?.employeeId !== undefined;

    let resolvedItems: ResolvedBookingItem[] = [];
    let acceptedTravelBlocks: EmployeeTravelBlock[] = [];
    let settings: BookingSettingsSnapshot | undefined;
    if (schedulable) {
      const line = serviceLines[0];
      const locked = await lockAndRecheckSlots(
        [
          {
            serviceId: line.serviceId!.toString(),
            employeeId: line.employeeId!.toString(),
            startAt: currentQuote.proposedStartAt!,
          },
        ],
        {
          branchId: currentQuote.branchId.toString(),
          customerGender: customer.gender,
          staff: true,
          travel: {
            travelMinutesBefore: initialInquiry.offsite
              ? currentQuote.travelMinutesBefore
              : 0,
            travelMinutesAfter: initialInquiry.offsite
              ? currentQuote.travelMinutesAfter
              : 0,
          },
        },
      );
      slotLease = locked.lease;
      acceptedTravelBlocks = locked.travelBlocks;
      const slot = locked.slots[0];
      if (slot.endAt.getTime() !== currentQuote.proposedEndAt!.getTime()) {
        await slotLease.release();
        slotLease = undefined;
        throw ApiError.conflict(
          "The proposed quote duration no longer matches service scheduling rules",
          {
            proposedEndAt: currentQuote.proposedEndAt,
            currentEndAt: slot.endAt,
          },
          "QUOTE_SCHEDULE_CHANGED",
        );
      }
      [resolvedItems, settings] = await Promise.all([
        loadResolvedItemMetadata(currentQuote.branchId.toString(), locked.slots),
        getSettings(),
      ]);
    }

    return await withTransaction(async (session) => {
      await slotLease?.assertValid();
      const quote = await BookingQuote.findById(quoteId).session(session);
      if (!quote) throw ApiError.notFound("Quote was not found", "QUOTE_NOT_FOUND");
      const inquiry = await BookingInquiry.findOne({
        _id: quote.inquiryId,
        customerId: customer._id,
      }).session(session);
      if (!inquiry) throw ApiError.notFound("Quote was not found", "QUOTE_NOT_FOUND");
      if (quote.status === "accepted") return acceptedQuoteResult(quote._id);
      if (
        quote.status !== "sent" ||
        quote.validUntil <= new Date() ||
        !["quoted", "reviewing"].includes(inquiry.status)
      ) {
        throw ApiError.conflict("Quote can no longer be accepted", "QUOTE_NOT_ACCEPTABLE");
      }
      const otherAccepted = await BookingQuote.exists({
        inquiryId: inquiry._id,
        status: "accepted",
        _id: { $ne: quote._id },
      }).session(session);
      if (otherAccepted) {
        throw ApiError.conflict(
          "Another quote revision is already accepted",
          "INQUIRY_ALREADY_ACCEPTED",
        );
      }

      let created:
        | Awaited<ReturnType<typeof createResolvedAggregate>>
        | undefined;
      if (schedulable && settings && resolvedItems.length === 1) {
        const serviceLine = quote.lines.find((line) => line.type === "service")!;
        const productLines = quote.lines.filter((line) => line.type === "product");
        const productIds = productLines.map((line) => line.productId!);
        const products = await Product.find({
          _id: { $in: productIds },
          isActive: true,
        })
          .session(session)
          .lean();
        const productMap = new Map(
          products.map((product) => [product._id.toString(), product]),
        );
        if (productMap.size !== new Set(productIds.map(String)).size) {
          throw ApiError.conflict(
            "A quoted product is no longer available",
            "QUOTE_PRODUCT_UNAVAILABLE",
          );
        }
        const productQuantities = new Map<string, number>();
        for (const line of productLines) {
          const key = line.productId!.toString();
          productQuantities.set(
            key,
            (productQuantities.get(key) ?? 0) + line.quantity,
          );
        }
        if ([...productQuantities.values()].some((quantity) => quantity > 500)) {
          throw ApiError.conflict(
            "Combined quoted product quantity exceeds booking limits",
            "QUOTE_PRODUCT_QUANTITY_INVALID",
          );
        }
        created = await createResolvedAggregate({
          branchId: quote.branchId.toString(),
          customer,
          resolvedItems,
          travelBlocks: acceptedTravelBlocks,
          settings,
          actorUserId: context.actor.userId,
          source: "online",
          idempotencyKey: idempotency.stored,
          quoteId: quote._id,
          quoteLineIds: [
            (serviceLine as unknown as { _id: Types.ObjectId })._id,
          ],
          quotedAmounts: [serviceLine.amountMinor],
          quotedTotalMinor: quote.quotedTotalMinor,
          advanceRequirementOverride: quote.advanceRequirement,
          advanceDueOverride: quote.advanceDueMinor,
          customerAcceptedVariablePricing: true,
          customerNote: inquiry.customerNote,
          event: {
            type: inquiry.offsite
              ? "offsite"
              : inquiry.type === "wedding"
                ? "wedding"
                : inquiry.partySize > 1
                  ? "group"
                  : "standard",
            name:
              inquiry.type === "wedding" || inquiry.type === "event"
                ? `${inquiry.type} inquiry`
                : undefined,
            partySize: inquiry.partySize,
            offsiteAddress: inquiry.venueAddress,
            travelMinutesBefore: inquiry.offsite
              ? quote.travelMinutesBefore
              : 0,
            travelMinutesAfter: inquiry.offsite
              ? quote.travelMinutesAfter
              : 0,
          },
          includedProducts: [...productQuantities].map(([productId, quantity]) => {
            const product = productMap.get(productId)!;
            return {
              productId: product._id,
              code: product.code,
              name: product.name,
              quantity,
            };
          }),
          session,
        });
      }

      quote.status = "accepted";
      quote.acceptedAt = new Date();
      await quote.save({ session });
      inquiry.status = "accepted";
      await inquiry.save({ session });
      await BookingQuote.updateMany(
        {
          inquiryId: inquiry._id,
          _id: { $ne: quote._id },
          status: { $in: ["draft", "sent"] },
        },
        { $set: { status: "superseded" } },
        { session },
      );
      await OutboxEvent.create(
        [
          {
            aggregateType: "booking_quote",
            aggregateId: quote._id,
            eventType: "booking.quote.accepted",
            payload: {
              quoteId: quote.id,
              inquiryId: inquiry.id,
              customerId: customer.id,
              ...(created ? { bookingId: created.booking.id } : {}),
              schedulingStatus: created
                ? "booking_created"
                : "staff_scheduling_required",
            },
          },
        ],
        { session },
      );
      await recordAudit(
        {
          context: context.audit,
          action: "booking.quote.accepted",
          entityType: "BookingQuote",
          entityId: quote._id,
        },
        session,
      );
      await slotLease?.assertValid();
      if (!created) {
        return {
          quoteId: quote.id,
          inquiryStatus: inquiry.status,
          schedulingStatus: "staff_scheduling_required" as const,
          booking: null,
          message:
            "Quote accepted. Staff scheduling is required because the quote does not contain exactly one complete service, employee, start, and end proposal.",
        };
      }
      return {
        quoteId: quote.id,
        inquiryStatus: inquiry.status,
        schedulingStatus: "booking_created" as const,
        booking: publicBookingAggregate(
          created.booking.toObject() as unknown as Record<string, unknown>,
          created.items,
          true,
        ),
      };
    });
  } finally {
    await slotLease?.release();
    await redisService.releaseLock(quoteLockKey, quoteLockToken);
  }
};

const scheduleAcceptedQuote = async (
  quoteId: string,
  input: ScheduleAcceptedQuoteBody,
  rawIdempotencyKey: string | undefined,
  context: BookingRequestContext,
) => {
  requireStaffScope(context.actor);
  const rawKey = requireIdempotencyKey(rawIdempotencyKey);
  const quoteLockKey = `booking-quote:${quoteId}:schedule`;
  const quoteLockToken = await redisService.acquireLock(quoteLockKey, 90_000);
  if (!quoteLockToken) {
    throw ApiError.conflict(
      "This accepted quote is currently being scheduled",
      "QUOTE_SCHEDULING_IN_PROGRESS",
    );
  }

  let slotLease: SlotLockLease | undefined;
  try {
    const quote = await BookingQuote.findById(quoteId);
    if (!quote) throw ApiError.notFound("Quote was not found", "QUOTE_NOT_FOUND");
    assertActorCanAccessBranch(context.actor, quote.branchId.toString());
    const existingBooking = await Booking.findOne({ quoteId: quote._id });
    if (existingBooking) {
      const aggregate = await bookingRepository.loadAggregate(existingBooking._id, {
        includePrivate: true,
      });
      if (!aggregate) throw ApiError.conflict("Quote booking could not be loaded");
      return {
        schedulingStatus: "booking_created" as const,
        idempotentReplay: true,
        booking: publicBookingAggregate(
          aggregate.booking.toObject() as unknown as Record<string, unknown>,
          aggregate.items.map((item) => item.toObject()),
          false,
        ),
      };
    }
    if (quote.status !== "accepted") {
      throw ApiError.conflict(
        "Only an accepted quote can be scheduled",
        "QUOTE_NOT_ACCEPTED",
      );
    }
    const inquiry = await BookingInquiry.findById(quote.inquiryId);
    if (!inquiry || inquiry.status !== "accepted") {
      throw ApiError.conflict(
        "Accepted inquiry could not be loaded",
        "INQUIRY_NOT_ACCEPTED",
      );
    }
    const customer = await Customer.findById(inquiry.customerId);
    if (!customer || customer.status !== "active") {
      throw ApiError.conflict(
        "Customer is no longer active",
        "CUSTOMER_PROFILE_INACTIVE",
      );
    }

    const expandedServiceLines = quote.lines
      .filter((line) => line.type === "service")
      .flatMap((line) =>
        Array.from({ length: line.quantity }, (_, quantityIndex) => {
          const baseAmount = Math.floor(line.amountMinor / line.quantity);
          return {
            line,
            allocatedAmountMinor:
              baseAmount +
              (quantityIndex < line.amountMinor % line.quantity ? 1 : 0),
          };
        }),
      );
    if (
      expandedServiceLines.length === 0 ||
      expandedServiceLines.length !== input.items.length
    ) {
      throw ApiError.badRequest(
        "Provide one scheduled item for each quoted service unit",
        {
          expectedItems: expandedServiceLines.length,
          receivedItems: input.items.length,
        },
        "QUOTE_SCHEDULE_ITEM_MISMATCH",
      );
    }
    expandedServiceLines.forEach(({ line }, index) => {
      const item = input.items[index];
      if (
        !item ||
        !line.serviceId?.equals(item.serviceId) ||
        (line.employeeId && !line.employeeId.equals(item.employeeId))
      ) {
        throw ApiError.badRequest(
          "Scheduled services and quoted employees must match the accepted quote order",
          { index },
          "QUOTE_SCHEDULE_ITEM_MISMATCH",
        );
      }
    });

    const locked = await lockAndRecheckSlots(input.items, {
      branchId: quote.branchId.toString(),
      customerGender: customer.gender,
      staff: true,
      travel: {
        travelMinutesBefore: inquiry.offsite
          ? quote.travelMinutesBefore
          : 0,
        travelMinutesAfter: inquiry.offsite
          ? quote.travelMinutesAfter
          : 0,
      },
    });
    slotLease = locked.lease;
    const [settings, resolvedItems] = await Promise.all([
      getSettings(),
      loadResolvedItemMetadata(quote.branchId.toString(), locked.slots),
    ]);
    const fingerprint = hash(
      JSON.stringify({
        quoteId,
        items: input.items.map((item) => ({
          ...item,
          startAt: item.startAt.toISOString(),
        })),
        internalNote: input.internalNote ?? null,
      }),
    );
    const idempotency = makeIdempotencyKey(
      customer.id,
      "quote:schedule",
      rawKey,
      fingerprint,
    );

    return await withTransaction(async (session) => {
      await slotLease?.assertValid();
      const currentQuote = await BookingQuote.findOne({
        _id: quote._id,
        status: "accepted",
      }).session(session);
      const currentInquiry = await BookingInquiry.findOne({
        _id: inquiry._id,
        status: "accepted",
      }).session(session);
      if (!currentQuote || !currentInquiry) {
        throw ApiError.conflict(
          "Accepted quote changed while scheduling",
          "QUOTE_CHANGED",
        );
      }
      const duplicate = await Booking.findOne({ quoteId: quote._id }).session(
        session,
      );
      if (duplicate) {
        throw ApiError.conflict(
          "The accepted quote is already scheduled",
          "QUOTE_ALREADY_SCHEDULED",
        );
      }
      const productLines = currentQuote.lines.filter(
        (line) => line.type === "product",
      );
      const products = await Product.find({
        _id: { $in: productLines.map((line) => line.productId!) },
        isActive: true,
      })
        .session(session)
        .lean();
      const productMap = new Map(
        products.map((product) => [product._id.toString(), product]),
      );
      if (productMap.size !== new Set(productLines.map((line) => line.productId!.toString())).size) {
        throw ApiError.conflict(
          "A quoted product is no longer available",
          "QUOTE_PRODUCT_UNAVAILABLE",
        );
      }
      const productQuantities = new Map<string, number>();
      for (const line of productLines) {
        const key = line.productId!.toString();
        productQuantities.set(
          key,
          (productQuantities.get(key) ?? 0) + line.quantity,
        );
      }
      if ([...productQuantities.values()].some((quantity) => quantity > 500)) {
        throw ApiError.conflict(
          "Combined quoted product quantity exceeds booking limits",
          "QUOTE_PRODUCT_QUANTITY_INVALID",
        );
      }
      const created = await createResolvedAggregate({
        branchId: currentQuote.branchId.toString(),
        customer,
        resolvedItems,
        travelBlocks: locked.travelBlocks,
        settings,
        actorUserId: context.actor.userId,
        source: "admin",
        idempotencyKey: idempotency.stored,
        quoteId: currentQuote._id,
        quoteLineIds: expandedServiceLines.map(
          ({ line }) =>
            (line as unknown as { _id: Types.ObjectId })._id,
        ),
        quotedAmounts: expandedServiceLines.map(
          ({ allocatedAmountMinor }) => allocatedAmountMinor,
        ),
        quotedTotalMinor: currentQuote.quotedTotalMinor,
        advanceRequirementOverride: currentQuote.advanceRequirement,
        advanceDueOverride: currentQuote.advanceDueMinor,
        customerAcceptedVariablePricing: true,
        customerNote: currentInquiry.customerNote,
        internalNote: input.internalNote,
        event: {
          type: currentInquiry.offsite
            ? "offsite"
            : currentInquiry.type === "wedding"
              ? "wedding"
              : currentInquiry.partySize > 1
                ? "group"
                : "standard",
          name:
            currentInquiry.type === "wedding" ||
            currentInquiry.type === "event"
              ? `${currentInquiry.type} inquiry`
              : undefined,
          partySize: currentInquiry.partySize,
          offsiteAddress: currentInquiry.venueAddress,
          travelMinutesBefore: currentInquiry.offsite
            ? currentQuote.travelMinutesBefore
            : 0,
          travelMinutesAfter: currentInquiry.offsite
            ? currentQuote.travelMinutesAfter
            : 0,
        },
        includedProducts: [...productQuantities].map(([productId, quantity]) => {
          const product = productMap.get(productId)!;
          return {
            productId: product._id,
            code: product.code,
            name: product.name,
            quantity,
          };
        }),
        session,
      });
      await OutboxEvent.create(
        [
          {
            aggregateType: "booking_quote",
            aggregateId: currentQuote._id,
            eventType: "booking.quote.scheduled",
            payload: {
              quoteId: currentQuote.id,
              inquiryId: currentInquiry.id,
              bookingId: created.booking.id,
            },
          },
        ],
        { session },
      );
      await recordAudit(
        {
          context: context.audit,
          action: "booking.quote.scheduled",
          entityType: "BookingQuote",
          entityId: currentQuote._id,
          changes: { bookingId: created.booking.id },
        },
        session,
      );
      await slotLease?.assertValid();
      return {
        schedulingStatus: "booking_created" as const,
        idempotentReplay: false,
        booking: publicBookingAggregate(
          created.booking.toObject() as unknown as Record<string, unknown>,
          created.items,
          false,
        ),
      };
    });
  } finally {
    await slotLease?.release();
    await redisService.releaseLock(quoteLockKey, quoteLockToken);
  }
};

export const bookingService = {
  create,
  list,
  get,
  listMyEmployeeBookings,
  getMyEmployeeBooking,
  cancel,
  reschedule,
  transition,
  updateExternalSettlement,
  expireDueHolds,
  acceptQuote,
  scheduleAcceptedQuote,
};
