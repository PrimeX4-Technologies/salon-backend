import type { ClientSession, QueryFilter, Types } from "mongoose";

import WaitlistEntry, {
  type IWaitlistEntry,
} from "../models/bookings/WaitlistEntry.js";
import Branch from "../models/business/Branch.js";
import BusinessSettings from "../models/business/BusinessSettings.js";
import BranchService from "../models/catalog/BranchService.js";
import Service from "../models/catalog/Service.js";
import OutboxEvent from "../models/events/OutboxEvent.js";
import Employee from "../models/staff/Employee.js";
import EmployeeService from "../models/staff/EmployeeService.js";
import type { BookingRequestContext } from "../types/booking-api.js";
import { ApiError } from "../utils/ApiError.js";
import { withTransaction } from "../utils/database.js";
import {
  buildPaginationMeta,
  parsePagination,
  parseSort,
} from "../utils/pagination.js";
import type {
  CreateWaitlistBody,
  OfferWaitlistBody,
  WaitlistListQuery,
} from "../validation/booking.schemas.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";
import {
  assertActorCanAccessBranch,
  assertBranchInScope,
  requireCustomerForActor,
  requireStaffScope,
} from "./booking-access.service.js";

const addOutbox = async (
  aggregateId: Types.ObjectId,
  eventType: string,
  payload: Record<string, unknown>,
  session: ClientSession,
): Promise<void> => {
  await OutboxEvent.create(
    [
      {
        aggregateType: "waitlist",
        aggregateId,
        eventType,
        payload,
      },
    ],
    { session },
  );
};

const resolveRequiredMinutes = async (
  branchId: string,
  serviceIds: string[],
): Promise<number> => {
  const uniqueIds = [...new Set(serviceIds)];
  const [services, branchServices] = await Promise.all([
    Service.find({
      _id: { $in: uniqueIds },
      isActive: true,
      bookingMode: { $ne: "consultation_required" },
    }).lean(),
    BranchService.find({
      branchId,
      serviceId: { $in: uniqueIds },
      isActive: true,
    }).lean(),
  ]);
  if (services.length !== uniqueIds.length || branchServices.length !== uniqueIds.length) {
    throw ApiError.badRequest(
      "One or more selected services are unavailable at this branch",
      undefined,
      "SERVICE_BRANCH_UNAVAILABLE",
    );
  }
  const branchMap = new Map(
    branchServices.map((entry) => [entry.serviceId.toString(), entry]),
  );
  const total = services.reduce((sum, service) => {
    const duration =
      branchMap.get(service._id.toString())?.durationOverride ?? service.duration;
    return (
      sum +
      duration.applicationMinutes +
      duration.processingMinutes +
      duration.finishingMinutes +
      duration.bufferMinutes
    );
  }, 0);
  if (total < 1 || total > 2880) {
    throw ApiError.badRequest(
      "Combined service duration is outside waitlist limits",
      undefined,
      "WAITLIST_DURATION_INVALID",
    );
  }
  return total;
};

const validatePreferredEmployees = async (
  branchId: string,
  serviceIds: string[],
  employeeIds: string[],
): Promise<void> => {
  const uniqueIds = [...new Set(employeeIds)];
  if (uniqueIds.length === 0) return;
  const [employees, capabilities] = await Promise.all([
    Employee.find({
      _id: { $in: uniqueIds },
      branchIds: branchId,
      status: "active",
      isBookable: true,
    }).select("_id"),
    EmployeeService.find({
      branchId,
      employeeId: { $in: uniqueIds },
      serviceId: { $in: serviceIds },
      isActive: true,
    }).select("employeeId"),
  ]);
  const capableIds = new Set(capabilities.map((item) => item.employeeId.toString()));
  if (
    employees.length !== uniqueIds.length ||
    uniqueIds.some((employeeId) => !capableIds.has(employeeId))
  ) {
    throw ApiError.badRequest(
      "One or more preferred employees cannot perform the selected services",
      undefined,
      "PREFERRED_EMPLOYEE_UNAVAILABLE",
    );
  }
};

const create = async (
  input: CreateWaitlistBody,
  context: BookingRequestContext,
) => {
  const customer = await requireCustomerForActor(context.actor, input.customerId);
  assertActorCanAccessBranch(context.actor, input.branchId);
  const [branch, settings] = await Promise.all([
    Branch.findOne({
      _id: input.branchId,
      isActive: true,
      bookingsEnabled: true,
    }).select("_id"),
    BusinessSettings.findOne({ singletonKey: "default" }).select("booking.allowWaitlist"),
  ]);
  if (!branch) throw ApiError.notFound("Branch is not bookable", "BRANCH_NOT_BOOKABLE");
  if (!settings?.booking.allowWaitlist) {
    throw ApiError.conflict("The waitlist is currently disabled", "WAITLIST_DISABLED");
  }
  if (input.windowEndAt <= new Date()) {
    throw ApiError.badRequest(
      "Waitlist window must end in the future",
      undefined,
      "WAITLIST_WINDOW_PAST",
    );
  }

  const requiredMinutes = await resolveRequiredMinutes(
    input.branchId,
    input.serviceIds,
  );
  await validatePreferredEmployees(
    input.branchId,
    input.serviceIds,
    input.preferredEmployeeIds,
  );
  const source =
    context.actor.role === "customer" ? "online" : (input.source ?? "admin");
  const priority = context.actor.role === "customer" ? 0 : (input.priority ?? 0);

  return withTransaction(async (session) => {
    const [entry] = await WaitlistEntry.create(
      [
        {
          branchId: input.branchId,
          customerId: customer._id,
          serviceIds: [...new Set(input.serviceIds)],
          preferredEmployeeIds: [...new Set(input.preferredEmployeeIds)],
          windowStartAt: input.windowStartAt,
          windowEndAt: input.windowEndAt,
          requiredMinutes,
          partySize: input.partySize,
          priority,
          source,
          status: "waiting",
          ...(input.note ? { note: input.note } : {}),
        },
      ],
      { session },
    );
    await addOutbox(
      entry._id,
      "booking.waitlist.joined",
      {
        waitlistEntryId: entry.id,
        branchId: input.branchId,
        customerId: customer.id,
      },
      session,
    );
    await recordAudit(
      {
        context: context.audit,
        action: "booking.waitlist.joined",
        entityType: "WaitlistEntry",
        entityId: entry._id,
      },
      session,
    );
    return entry.toObject();
  });
};

const list = async (
  query: WaitlistListQuery,
  context: BookingRequestContext,
) => {
  const pagination = parsePagination(query);
  const filter: QueryFilter<IWaitlistEntry> = {};
  if (context.actor.role === "customer") {
    const customer = await requireCustomerForActor(context.actor);
    filter.customerId = customer._id;
  } else {
    const scope = requireStaffScope(context.actor);
    if (!scope.allBranches) filter.branchId = { $in: scope.branchIds };
    if (query.customerId) filter.customerId = query.customerId;
  }
  if (query.branchId) {
    assertActorCanAccessBranch(context.actor, query.branchId);
    filter.branchId = query.branchId;
  }
  if (query.status) filter.status = query.status;
  if (query.serviceId) filter.serviceIds = query.serviceId;
  if (query.employeeId) {
    filter.$or = [
      { preferredEmployeeIds: { $size: 0 } },
      { preferredEmployeeIds: query.employeeId },
    ];
  }
  if (query.fitsStartAt && query.fitsEndAt) {
    const durationMinutes =
      (query.fitsEndAt.getTime() - query.fitsStartAt.getTime()) / 60_000;
    filter.status = "waiting";
    filter.windowStartAt = { $lte: query.fitsStartAt };
    filter.windowEndAt = { $gte: query.fitsEndAt };
    filter.requiredMinutes = { $lte: durationMinutes };
  }

  const [items, total] = await Promise.all([
    WaitlistEntry.find(filter)
      .sort(
        query.fitsStartAt
          ? { priority: -1, createdAt: 1 }
          : parseSort(query.sort, ["createdAt", "updatedAt", "windowStartAt", "priority"], "-createdAt"),
      )
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    WaitlistEntry.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, pagination) };
};

const get = async (
  entryId: string,
  context: BookingRequestContext,
) => {
  const entry = await WaitlistEntry.findById(entryId).lean();
  if (!entry) {
    throw ApiError.notFound("Waitlist entry was not found", "WAITLIST_ENTRY_NOT_FOUND");
  }
  if (context.actor.role === "customer") {
    const customer = await requireCustomerForActor(context.actor);
    if (!entry.customerId.equals(customer._id)) {
      throw ApiError.notFound(
        "Waitlist entry was not found",
        "WAITLIST_ENTRY_NOT_FOUND",
      );
    }
  } else {
    assertActorCanAccessBranch(context.actor, entry.branchId.toString());
  }
  return entry;
};

const cancel = async (
  entryId: string,
  reason: string | undefined,
  context: BookingRequestContext,
) =>
  withTransaction(async (session) => {
    const entry = await WaitlistEntry.findById(entryId).session(session);
    if (!entry) {
      throw ApiError.notFound("Waitlist entry was not found", "WAITLIST_ENTRY_NOT_FOUND");
    }
    if (context.actor.role === "customer") {
      const customer = await requireCustomerForActor(context.actor);
      if (!entry.customerId.equals(customer._id)) {
        throw ApiError.notFound(
          "Waitlist entry was not found",
          "WAITLIST_ENTRY_NOT_FOUND",
        );
      }
    } else {
      assertActorCanAccessBranch(context.actor, entry.branchId.toString());
    }
    if (!["waiting", "offered"].includes(entry.status)) {
      throw ApiError.conflict(
        "Waitlist entry can no longer be cancelled",
        "WAITLIST_NOT_CANCELLABLE",
      );
    }
    entry.status = "cancelled";
    entry.offeredUntil = undefined;
    await entry.save({ session });
    await addOutbox(
      entry._id,
      "booking.waitlist.cancelled",
      {
        waitlistEntryId: entry.id,
        branchId: entry.branchId.toString(),
        customerId: entry.customerId.toString(),
      },
      session,
    );
    await recordAudit(
      {
        context: context.audit,
        action: "booking.waitlist.cancelled",
        entityType: "WaitlistEntry",
        entityId: entry._id,
        ...(reason ? { changes: { reason } } : {}),
      },
      session,
    );
    return { id: entry.id, status: entry.status };
  });

const offer = async (
  entryId: string,
  input: OfferWaitlistBody,
  context: BookingRequestContext,
) => {
  requireStaffScope(context.actor);
  return withTransaction(async (session) => {
    const entry = await WaitlistEntry.findById(entryId).session(session);
    if (!entry) {
      throw ApiError.notFound("Waitlist entry was not found", "WAITLIST_ENTRY_NOT_FOUND");
    }
    assertActorCanAccessBranch(context.actor, entry.branchId.toString());
    if (entry.status !== "waiting" || entry.windowEndAt <= new Date()) {
      throw ApiError.conflict("Waitlist entry cannot be offered", "WAITLIST_NOT_OFFERABLE");
    }
    if (input.offeredUntil > entry.windowEndAt) {
      throw ApiError.badRequest(
        "Offer expiry cannot extend beyond the customer's waitlist window",
        undefined,
        "WAITLIST_OFFER_OUTSIDE_WINDOW",
      );
    }
    entry.status = "offered";
    entry.offeredUntil = input.offeredUntil;
    if (input.note === null) entry.note = undefined;
    else if (input.note !== undefined) entry.note = input.note;
    await entry.save({ session });
    await addOutbox(
      entry._id,
      "booking.waitlist.offered",
      {
        waitlistEntryId: entry.id,
        branchId: entry.branchId.toString(),
        customerId: entry.customerId.toString(),
        offeredUntil: input.offeredUntil.toISOString(),
      },
      session,
    );
    return entry.toObject();
  });
};

interface ExpireDueWaitlistOptions {
  now: Date;
  limit: number;
  auditContext: AuditActorContext;
  scope?: {
    allBranches: boolean;
    branchIds: string[];
  };
}

const expireDueCore = async ({
  now,
  limit,
  auditContext,
  scope,
}: ExpireDueWaitlistOptions) => {
  const filter: QueryFilter<IWaitlistEntry> = {
    $or: [
      { status: "offered", offeredUntil: { $lte: now } },
      { status: "offered", windowEndAt: { $lte: now } },
      { status: "waiting", windowEndAt: { $lte: now } },
    ],
  };
  if (scope && !scope.allBranches) {
    filter.branchId = { $in: scope.branchIds };
  }
  const entries = await WaitlistEntry.find(filter).select("_id branchId").limit(limit);
  let expired = 0;
  for (const candidate of entries) {
    const didExpire = await withTransaction(async (session) => {
      const entry = await WaitlistEntry.findOne({
        _id: candidate._id,
        $or: [
          { status: "offered", offeredUntil: { $lte: now } },
          { status: "offered", windowEndAt: { $lte: now } },
          { status: "waiting", windowEndAt: { $lte: now } },
        ],
      }).session(session);
      if (!entry) return false;
      if (scope) assertBranchInScope(entry.branchId.toString(), scope);
      entry.status = "expired";
      entry.offeredUntil = undefined;
      await entry.save({ session });
      await addOutbox(
        entry._id,
        "booking.waitlist.expired",
        { waitlistEntryId: entry.id, branchId: entry.branchId.toString() },
        session,
      );
      await recordAudit(
        {
          context: auditContext,
          action: "booking.waitlist.expired",
          entityType: "WaitlistEntry",
          entityId: entry._id,
          changes: {
            status: "expired",
            windowEndAt: entry.windowEndAt,
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

const expireDue = async (
  context: BookingRequestContext,
  limit = 200,
) =>
  expireDueCore({
    now: new Date(),
    limit,
    auditContext: context.audit,
    scope: requireStaffScope(context.actor),
  });

export const expireDueWaitlistEntriesForSystem = async (
  options: {
    now?: Date;
    limit?: number;
    workerId?: string;
  } = {},
) =>
  expireDueCore({
    now: options.now ?? new Date(),
    limit: options.limit ?? 200,
    auditContext: {
      actorType: "system",
      ...(options.workerId
        ? { requestId: `booking-lifecycle:${options.workerId}` }
        : {}),
    },
  });

export const waitlistService = {
  create,
  list,
  get,
  cancel,
  offer,
  expireDue,
};
