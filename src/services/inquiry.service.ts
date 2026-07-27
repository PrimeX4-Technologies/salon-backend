import type { ClientSession, QueryFilter } from "mongoose";
import { Types } from "mongoose";

import BookingInquiry, {
  type IBookingInquiry,
} from "../models/bookings/BookingInquiry.js";
import BookingQuote, {
  type IBookingQuote,
} from "../models/bookings/BookingQuote.js";
import Branch from "../models/business/Branch.js";
import Product from "../models/catalog/Product.js";
import Service from "../models/catalog/Service.js";
import ServicePackage from "../models/catalog/ServicePackage.js";
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
  CreateInquiryBody,
  CreateQuoteBody,
  InquiryListQuery,
  RejectInquiryBody,
  ReviewInquiryBody,
} from "../validation/booking.schemas.js";
import {
  assertActorCanAccessBranch,
  requireCustomerForActor,
  requireStaffScope,
  scopeInquiryFilter,
} from "./booking-access.service.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";
import { redisService } from "./redis.service.js";

const addOutbox = async (
  aggregateType: "booking_quote",
  aggregateId: Types.ObjectId,
  eventType: string,
  payload: Record<string, unknown>,
  session: ClientSession,
): Promise<void> => {
  await OutboxEvent.create(
    [{ aggregateType, aggregateId, eventType, payload }],
    { session },
  );
};

const inquiryView = async (
  inquiry: InstanceType<typeof BookingInquiry>,
  staff: boolean,
) => {
  const quoteDocuments = await BookingQuote.find({
    inquiryId: inquiry._id,
    ...(staff ? {} : { status: { $ne: "draft" } }),
  })
    .sort({ revision: -1 })
    .lean();
  const quotes = quoteDocuments.map((quote) => {
    if (staff) return quote;
    const safe = { ...quote } as unknown as Record<string, unknown>;
    delete safe.createdByUserId;
    delete safe.__v;
    return safe;
  });
  const value = inquiry.toObject() as unknown as Record<string, unknown>;
  if (!staff) {
    delete value.internalNote;
    delete value.assignedToUserId;
  }
  return { ...value, quotes };
};

const validateInquiryReferences = async (input: CreateInquiryBody): Promise<void> => {
  if (input.branchId) {
    const branch = await Branch.findOne({
      _id: input.branchId,
      isActive: true,
      bookingsEnabled: true,
    }).select("_id");
    if (!branch) {
      throw ApiError.notFound(
        "An active booking branch was not found",
        "BRANCH_NOT_BOOKABLE",
      );
    }
  }

  if (input.packageId) {
    const servicePackage = await ServicePackage.findOne({
      _id: input.packageId,
      isActive: true,
      isPublished: true,
    });
    if (!servicePackage) {
      throw ApiError.notFound("Package was not found", "PACKAGE_NOT_FOUND");
    }
    if (
      input.branchId &&
      !servicePackage.availableAtAllBranches &&
      !servicePackage.branchIds.some((id) => id.equals(input.branchId))
    ) {
      throw ApiError.badRequest(
        "The package is not available at this branch",
        undefined,
        "PACKAGE_BRANCH_UNAVAILABLE",
      );
    }
    if (
      (input.type === "wedding" || input.type === "event") &&
      servicePackage.kind !== input.type
    ) {
      throw ApiError.badRequest(
        "The package kind does not match the inquiry type",
        undefined,
        "PACKAGE_TYPE_MISMATCH",
      );
    }
    if (input.offsite && !servicePackage.allowsOffsite) {
      throw ApiError.badRequest(
        "This package is not available off site",
        undefined,
        "OFFSITE_NOT_SUPPORTED",
      );
    }
    if (
      input.partySize < servicePackage.minimumPartySize ||
      (servicePackage.maximumPartySize !== undefined &&
        input.partySize > servicePackage.maximumPartySize)
    ) {
      throw ApiError.badRequest(
        "Party size is outside the package limits",
        undefined,
        "PACKAGE_PARTY_SIZE_INVALID",
      );
    }
  }

  const uniqueServiceIds = [...new Set(input.serviceIds)];
  const serviceCount = await Service.countDocuments({
    _id: { $in: uniqueServiceIds },
    isActive: true,
  });
  if (serviceCount !== uniqueServiceIds.length) {
    throw ApiError.badRequest(
      "One or more selected services are unavailable",
      undefined,
      "SERVICE_UNAVAILABLE",
    );
  }

  const uniqueProductIds = [...new Set(input.productIds)];
  const products = await Product.find({
    _id: { $in: uniqueProductIds },
    isActive: true,
    isPublished: true,
  }).select("_id availableAtAllBranches branchIds");
  if (products.length !== uniqueProductIds.length) {
    throw ApiError.badRequest(
      "One or more selected products are unavailable",
      undefined,
      "PRODUCT_UNAVAILABLE",
    );
  }
  if (
    input.branchId &&
    products.some(
      (product) =>
        !product.availableAtAllBranches &&
        !product.branchIds.some((id) => id.equals(input.branchId)),
    )
  ) {
    throw ApiError.badRequest(
      "One or more products are unavailable at this branch",
      undefined,
      "PRODUCT_BRANCH_UNAVAILABLE",
    );
  }
};

const list = async (
  query: InquiryListQuery,
  context: BookingRequestContext,
) => {
  const pagination = parsePagination(query);
  const filter: QueryFilter<IBookingInquiry> = {};

  if (context.actor.role === "customer") {
    const customer = await requireCustomerForActor(context.actor);
    filter.customerId = customer._id;
  } else {
    scopeInquiryFilter(filter, requireStaffScope(context.actor));
    if (query.customerId) filter.customerId = query.customerId;
  }
  if (query.branchId) {
    assertActorCanAccessBranch(context.actor, query.branchId);
    filter.branchId = query.branchId;
  }
  if (query.status) filter.status = query.status;
  if (query.type) filter.type = query.type;

  const staff = context.actor.role !== "customer";
  const selection = staff ? "+internalNote" : "-internalNote -assignedToUserId";
  const [items, total] = await Promise.all([
    BookingInquiry.find(filter)
      .select(selection)
      .sort(parseSort(query.sort, ["createdAt", "updatedAt", "preferredDateFrom"], "-createdAt"))
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
    BookingInquiry.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, pagination) };
};

const get = async (
  inquiryId: string,
  context: BookingRequestContext,
) => {
  const staff = context.actor.role !== "customer";
  const inquiry = await BookingInquiry.findById(inquiryId).select(
    staff ? "+internalNote" : "-internalNote -assignedToUserId",
  );
  if (!inquiry) throw ApiError.notFound("Inquiry was not found", "INQUIRY_NOT_FOUND");

  if (context.actor.role === "customer") {
    const customer = await requireCustomerForActor(context.actor);
    if (!inquiry.customerId.equals(customer._id)) {
      throw ApiError.notFound("Inquiry was not found", "INQUIRY_NOT_FOUND");
    }
  } else if (inquiry.branchId) {
    assertActorCanAccessBranch(context.actor, inquiry.branchId.toString());
  } else {
    requireStaffScope(context.actor);
  }
  return inquiryView(inquiry, staff);
};

const create = async (
  input: CreateInquiryBody,
  context: BookingRequestContext,
) => {
  const customer = await requireCustomerForActor(
    context.actor,
    input.branchId && context.actor.role !== "customer"
      ? undefined
      : undefined,
  );
  if (context.actor.role !== "customer") {
    throw ApiError.badRequest(
      "Staff inquiry creation must use a customer workflow with customerId",
      undefined,
      "CUSTOMER_ID_REQUIRED",
    );
  }
  await validateInquiryReferences(input);

  return withTransaction(async (session) => {
    const [inquiry] = await BookingInquiry.create(
      [
        {
          customerId: customer._id,
          ...(input.branchId ? { branchId: input.branchId } : {}),
          ...(input.packageId ? { packageId: input.packageId } : {}),
          serviceIds: [...new Set(input.serviceIds)],
          productIds: [...new Set(input.productIds)],
          type: input.type,
          ...(input.preferredDateFrom
            ? { preferredDateFrom: input.preferredDateFrom }
            : {}),
          ...(input.preferredDateTo ? { preferredDateTo: input.preferredDateTo } : {}),
          partySize: input.partySize,
          offsite: input.offsite,
          ...(input.venueAddress ? { venueAddress: input.venueAddress } : {}),
          ...(input.customerNote ? { customerNote: input.customerNote } : {}),
          status: "new",
        },
      ],
      { session },
    );
    await addOutbox(
      "booking_quote",
      inquiry._id,
      "booking.inquiry.created",
      { inquiryId: inquiry.id, customerId: customer.id, branchId: input.branchId },
      session,
    );
    await recordAudit(
      {
        context: context.audit,
        action: "booking.inquiry.created",
        entityType: "BookingInquiry",
        entityId: inquiry._id,
      },
      session,
    );
    return inquiryView(inquiry, false);
  });
};

const cancel = async (
  inquiryId: string,
  context: BookingRequestContext,
) => {
  const customer = await requireCustomerForActor(context.actor);
  return withTransaction(async (session) => {
    const inquiry = await BookingInquiry.findOne({
      _id: inquiryId,
      customerId: customer._id,
    }).session(session);
    if (!inquiry) throw ApiError.notFound("Inquiry was not found", "INQUIRY_NOT_FOUND");
    if (!["new", "reviewing", "quoted"].includes(inquiry.status)) {
      throw ApiError.conflict(
        "This inquiry can no longer be cancelled",
        "INQUIRY_NOT_CANCELLABLE",
      );
    }
    inquiry.status = "cancelled";
    await inquiry.save({ session });
    await BookingQuote.updateMany(
      { inquiryId: inquiry._id, status: { $in: ["draft", "sent"] } },
      { $set: { status: "superseded" } },
      { session },
    );
    await addOutbox(
      "booking_quote",
      inquiry._id,
      "booking.inquiry.cancelled",
      { inquiryId: inquiry.id, customerId: customer.id },
      session,
    );
    await recordAudit(
      {
        context: context.audit,
        action: "booking.inquiry.cancelled",
        entityType: "BookingInquiry",
        entityId: inquiry._id,
      },
      session,
    );
    return { id: inquiry.id, status: inquiry.status };
  });
};

const review = async (
  inquiryId: string,
  input: ReviewInquiryBody,
  context: BookingRequestContext,
) => {
  requireStaffScope(context.actor);
  return withTransaction(async (session) => {
    const inquiry = await BookingInquiry.findById(inquiryId)
      .select("+internalNote")
      .session(session);
    if (!inquiry) throw ApiError.notFound("Inquiry was not found", "INQUIRY_NOT_FOUND");
    if (inquiry.branchId) {
      assertActorCanAccessBranch(context.actor, inquiry.branchId.toString());
    }
    if (!["new", "reviewing", "quoted"].includes(inquiry.status)) {
      throw ApiError.conflict("Inquiry is not reviewable", "INQUIRY_NOT_REVIEWABLE");
    }
    inquiry.status = "reviewing";
    inquiry.assignedToUserId = input.assignedToUserId
      ? new Types.ObjectId(input.assignedToUserId)
      : new Types.ObjectId(context.actor.userId);
    if (input.internalNote === null) inquiry.internalNote = undefined;
    else if (input.internalNote !== undefined) inquiry.internalNote = input.internalNote;
    await inquiry.save({ session });
    await recordAudit(
      {
        context: context.audit,
        action: "booking.inquiry.reviewed",
        entityType: "BookingInquiry",
        entityId: inquiry._id,
      },
      session,
    );
    return inquiryView(inquiry, true);
  });
};

const reject = async (
  inquiryId: string,
  input: RejectInquiryBody,
  context: BookingRequestContext,
) => {
  requireStaffScope(context.actor);
  return withTransaction(async (session) => {
    const inquiry = await BookingInquiry.findById(inquiryId)
      .select("+internalNote")
      .session(session);
    if (!inquiry) throw ApiError.notFound("Inquiry was not found", "INQUIRY_NOT_FOUND");
    if (inquiry.branchId) {
      assertActorCanAccessBranch(context.actor, inquiry.branchId.toString());
    }
    if (!["new", "reviewing", "quoted"].includes(inquiry.status)) {
      throw ApiError.conflict("Inquiry cannot be declined", "INQUIRY_NOT_DECLINABLE");
    }
    inquiry.status = "declined";
    inquiry.internalNote = [
      inquiry.internalNote,
      `Declined: ${input.reason}`,
    ].filter(Boolean).join("\n");
    await inquiry.save({ session });
    await BookingQuote.updateMany(
      { inquiryId: inquiry._id, status: { $in: ["draft", "sent"] } },
      { $set: { status: "superseded" } },
      { session },
    );
    await addOutbox(
      "booking_quote",
      inquiry._id,
      "booking.inquiry.declined",
      { inquiryId: inquiry.id },
      session,
    );
    await recordAudit(
      {
        context: context.audit,
        action: "booking.inquiry.declined",
        entityType: "BookingInquiry",
        entityId: inquiry._id,
        changes: { reason: input.reason },
      },
      session,
    );
    return { id: inquiry.id, status: inquiry.status };
  });
};

const resolveQuoteLines = async (
  input: CreateQuoteBody,
): Promise<Array<Record<string, unknown>>> => {
  const serviceIds = input.lines
    .filter((line) => line.type === "service")
    .map((line) => line.serviceId as string);
  const productIds = input.lines
    .filter((line) => line.type === "product")
    .map((line) => line.productId as string);
  const [services, products] = await Promise.all([
    Service.find({ _id: { $in: serviceIds }, isActive: true }).lean(),
    Product.find({
      _id: { $in: productIds },
      isActive: true,
      isPublished: true,
    }).lean(),
  ]);
  const serviceMap = new Map(services.map((item) => [item._id.toString(), item]));
  const productMap = new Map(products.map((item) => [item._id.toString(), item]));
  if (serviceMap.size !== new Set(serviceIds).size) {
    throw ApiError.badRequest(
      "One or more quote services are unavailable",
      undefined,
      "SERVICE_UNAVAILABLE",
    );
  }
  if (productMap.size !== new Set(productIds).size) {
    throw ApiError.badRequest(
      "One or more quote products are unavailable",
      undefined,
      "PRODUCT_UNAVAILABLE",
    );
  }

  for (const product of products) {
    if (
      !product.availableAtAllBranches &&
      !product.branchIds.some((id) => id.equals(input.branchId))
    ) {
      throw ApiError.badRequest(
        `Product ${product.name} is unavailable at this branch`,
        undefined,
        "PRODUCT_BRANCH_UNAVAILABLE",
      );
    }
  }

  const employeeIds = input.lines
    .map((line) => line.employeeId)
    .filter((id): id is string => Boolean(id));
  if (employeeIds.length > 0) {
    const [employees, capabilities] = await Promise.all([
      Employee.find({
        _id: { $in: employeeIds },
        branchIds: input.branchId,
        status: "active",
        isBookable: true,
      }).select("_id"),
      EmployeeService.find({
        branchId: input.branchId,
        employeeId: { $in: employeeIds },
        serviceId: { $in: serviceIds },
        isActive: true,
      }).select("employeeId serviceId"),
    ]);
    if (employees.length !== new Set(employeeIds).size) {
      throw ApiError.badRequest(
        "One or more quote employees are unavailable",
        undefined,
        "EMPLOYEE_UNAVAILABLE",
      );
    }
    const capabilitySet = new Set(
      capabilities.map(
        (row) => `${row.employeeId.toString()}:${row.serviceId.toString()}`,
      ),
    );
    for (const line of input.lines) {
      if (
        line.type === "service" &&
        line.employeeId &&
        !capabilitySet.has(`${line.employeeId}:${line.serviceId}`)
      ) {
        throw ApiError.badRequest(
          "A selected employee cannot perform the quote service",
          undefined,
          "EMPLOYEE_SERVICE_UNAVAILABLE",
        );
      }
    }
  }

  return input.lines.map((line) => {
    if (line.type === "service") {
      const service = serviceMap.get(line.serviceId as string)!;
      return {
        type: line.type,
        serviceId: service._id,
        name: service.name,
        ...(line.description ? { description: line.description } : {}),
        quantity: line.quantity,
        durationMinutes: line.durationMinutes,
        amountMinor: line.amountMinor,
        ...(line.employeeId ? { employeeId: line.employeeId } : {}),
      };
    }
    if (line.type === "product") {
      const product = productMap.get(line.productId as string)!;
      return {
        type: line.type,
        productId: product._id,
        name: product.name,
        ...(line.description ? { description: line.description } : {}),
        quantity: line.quantity,
        amountMinor: line.amountMinor,
      };
    }
    return {
      type: line.type,
      name: line.name,
      ...(line.description ? { description: line.description } : {}),
      quantity: line.quantity,
      amountMinor: line.amountMinor,
    };
  });
};

const createQuote = async (
  inquiryId: string,
  input: CreateQuoteBody,
  context: BookingRequestContext,
) => {
  requireStaffScope(context.actor);
  assertActorCanAccessBranch(context.actor, input.branchId);
  const branch = await Branch.findOne({
    _id: input.branchId,
    isActive: true,
    bookingsEnabled: true,
  }).select("_id");
  if (!branch) throw ApiError.notFound("Branch is not bookable", "BRANCH_NOT_BOOKABLE");

  const resolvedLines = await resolveQuoteLines(input);
  const quotedTotalMinor = input.lines.reduce(
    (sum, line) => sum + line.amountMinor,
    0,
  );
  if (input.advanceDueMinor > quotedTotalMinor) {
    throw ApiError.badRequest(
      "Advance cannot exceed the quote total",
      undefined,
      "ADVANCE_EXCEEDS_TOTAL",
    );
  }

  const lockKey = `booking-inquiry:${inquiryId}:quote`;
  const lockToken = await redisService.acquireLock(lockKey, 15_000);
  if (!lockToken) {
    throw ApiError.conflict(
      "This inquiry is currently being updated",
      "INQUIRY_UPDATE_IN_PROGRESS",
    );
  }
  try {
    return await withTransaction(async (session) => {
      const inquiry = await BookingInquiry.findById(inquiryId).session(session);
      if (!inquiry) throw ApiError.notFound("Inquiry was not found", "INQUIRY_NOT_FOUND");
      if (inquiry.branchId && !inquiry.branchId.equals(input.branchId)) {
        throw ApiError.badRequest(
          "Quote branch must match the inquiry branch",
          undefined,
          "QUOTE_BRANCH_MISMATCH",
        );
      }
      if (!["new", "reviewing", "quoted"].includes(inquiry.status)) {
        throw ApiError.conflict("Inquiry cannot be quoted", "INQUIRY_NOT_QUOTABLE");
      }
      if (
        !inquiry.offsite &&
        (input.travelMinutesBefore > 0 || input.travelMinutesAfter > 0)
      ) {
        throw ApiError.badRequest(
          "Travel buffers are supported only for off-site inquiries",
          undefined,
          "QUOTE_TRAVEL_NOT_OFFSITE",
        );
      }
      const previous = await BookingQuote.findOne({ inquiryId: inquiry._id })
        .sort({ revision: -1 })
        .session(session);
      const revision = (previous?.revision ?? 0) + 1;
      await BookingQuote.updateMany(
        { inquiryId: inquiry._id, status: { $in: ["draft", "sent"] } },
        { $set: { status: "superseded" } },
        { session },
      );
      const [quote] = await BookingQuote.create(
        [
          {
            inquiryId: inquiry._id,
            revision,
            status: input.send ? "sent" : "draft",
            validUntil: input.validUntil,
            branchId: input.branchId,
            ...(input.proposedStartAt
              ? { proposedStartAt: input.proposedStartAt }
              : {}),
            ...(input.proposedEndAt ? { proposedEndAt: input.proposedEndAt } : {}),
            travelMinutesBefore: input.travelMinutesBefore,
            travelMinutesAfter: input.travelMinutesAfter,
            currency: input.currency,
            lines: resolvedLines,
            quotedTotalMinor,
            advanceRequirement: input.advanceRequirement,
            advanceDueMinor: input.advanceDueMinor,
            ...(input.terms ? { terms: input.terms } : {}),
            ...(input.send ? { sentAt: new Date() } : {}),
            createdByUserId: context.actor.userId,
          },
        ],
        { session },
      );
      inquiry.branchId = new Types.ObjectId(input.branchId);
      inquiry.status = input.send ? "quoted" : "reviewing";
      inquiry.assignedToUserId = new Types.ObjectId(context.actor.userId);
      await inquiry.save({ session });
      await addOutbox(
        "booking_quote",
        quote._id,
        input.send ? "booking.quote.sent" : "booking.quote.drafted",
        {
          quoteId: quote.id,
          inquiryId: inquiry.id,
          revision,
          customerId: inquiry.customerId.toString(),
        },
        session,
      );
      await recordAudit(
        {
          context: context.audit,
          action: input.send ? "booking.quote.sent" : "booking.quote.created",
          entityType: "BookingQuote",
          entityId: quote._id,
        },
        session,
      );
      return quote.toObject();
    });
  } finally {
    await redisService.releaseLock(lockKey, lockToken);
  }
};

const sendQuote = async (
  quoteId: string,
  context: BookingRequestContext,
) => {
  requireStaffScope(context.actor);
  return withTransaction(async (session) => {
    const quote = await BookingQuote.findById(quoteId).session(session);
    if (!quote) throw ApiError.notFound("Quote was not found", "QUOTE_NOT_FOUND");
    assertActorCanAccessBranch(context.actor, quote.branchId.toString());
    if (quote.status !== "draft") {
      throw ApiError.conflict("Only a draft quote can be sent", "QUOTE_NOT_SENDABLE");
    }
    if (quote.validUntil <= new Date()) {
      quote.status = "expired";
      await quote.save({ session });
      throw ApiError.conflict("Quote has expired", "QUOTE_EXPIRED");
    }
    quote.status = "sent";
    quote.sentAt = new Date();
    await quote.save({ session });
    const inquiry = await BookingInquiry.findById(quote.inquiryId).session(session);
    if (!inquiry || !["new", "reviewing", "quoted"].includes(inquiry.status)) {
      throw ApiError.conflict("Inquiry can no longer be quoted", "INQUIRY_NOT_QUOTABLE");
    }
    inquiry.status = "quoted";
    await inquiry.save({ session });
    await addOutbox(
      "booking_quote",
      quote._id,
      "booking.quote.sent",
      { quoteId: quote.id, inquiryId: inquiry.id, customerId: inquiry.customerId.toString() },
      session,
    );
    await recordAudit(
      {
        context: context.audit,
        action: "booking.quote.sent",
        entityType: "BookingQuote",
        entityId: quote._id,
      },
      session,
    );
    return quote.toObject();
  });
};

const expireQuote = async (
  quoteId: string,
  context: BookingRequestContext,
) => {
  requireStaffScope(context.actor);
  return withTransaction(async (session) => {
    const quote = await BookingQuote.findById(quoteId).session(session);
    if (!quote) throw ApiError.notFound("Quote was not found", "QUOTE_NOT_FOUND");
    assertActorCanAccessBranch(context.actor, quote.branchId.toString());
    if (!["draft", "sent"].includes(quote.status)) {
      throw ApiError.conflict("Quote cannot be expired", "QUOTE_NOT_EXPIRABLE");
    }
    quote.status = "expired";
    await quote.save({ session });
    const inquiry = await BookingInquiry.findById(quote.inquiryId).session(session);
    if (inquiry?.status === "quoted") {
      inquiry.status = "reviewing";
      await inquiry.save({ session });
    }
    await addOutbox(
      "booking_quote",
      quote._id,
      "booking.quote.expired",
      { quoteId: quote.id, inquiryId: quote.inquiryId.toString() },
      session,
    );
    return quote.toObject();
  });
};

const rejectQuote = async (
  quoteId: string,
  reason: string | undefined,
  context: BookingRequestContext,
) => {
  const customer = await requireCustomerForActor(context.actor);
  return withTransaction(async (session) => {
    const quote = await BookingQuote.findById(quoteId).session(session);
    if (!quote) throw ApiError.notFound("Quote was not found", "QUOTE_NOT_FOUND");
    const inquiry = await BookingInquiry.findOne({
      _id: quote.inquiryId,
      customerId: customer._id,
    }).session(session);
    if (!inquiry) throw ApiError.notFound("Quote was not found", "QUOTE_NOT_FOUND");
    if (quote.status !== "sent") {
      throw ApiError.conflict("Quote cannot be rejected", "QUOTE_NOT_REJECTABLE");
    }
    quote.status = "rejected";
    await quote.save({ session });
    inquiry.status = "reviewing";
    if (reason) inquiry.customerNote = [inquiry.customerNote, `Quote feedback: ${reason}`].filter(Boolean).join("\n");
    await inquiry.save({ session });
    await addOutbox(
      "booking_quote",
      quote._id,
      "booking.quote.rejected",
      { quoteId: quote.id, inquiryId: inquiry.id, customerId: customer.id },
      session,
    );
    return { id: quote.id, status: quote.status };
  });
};

interface ExpireDueQuotesOptions {
  now: Date;
  limit: number;
  auditContext: AuditActorContext;
  scope?: {
    allBranches: boolean;
    branchIds: string[];
  };
}

const expireDueQuotesCore = async ({
  now,
  limit,
  auditContext,
  scope,
}: ExpireDueQuotesOptions) => {
  const filter: QueryFilter<IBookingQuote> = {
    status: { $in: ["draft", "sent"] },
    validUntil: { $lte: now },
  };
  if (scope && !scope.allBranches) {
    filter.branchId = { $in: scope.branchIds };
  }
  const quotes = await BookingQuote.find(filter)
    .select("_id branchId")
    .limit(limit);
  let expired = 0;
  for (const candidate of quotes) {
    const didExpire = await withTransaction(async (session) => {
      const quote = await BookingQuote.findOne({
        _id: candidate._id,
        status: { $in: ["draft", "sent"] },
        validUntil: { $lte: now },
      }).session(session);
      if (!quote) return false;
      if (
        scope &&
        !scope.allBranches &&
        !scope.branchIds.includes(quote.branchId.toString())
      ) {
        return false;
      }
      const previousStatus = quote.status;
      quote.status = "expired";
      await quote.save({ session });

      const inquiry = await BookingInquiry.findById(quote.inquiryId).session(
        session,
      );
      if (inquiry?.status === "quoted") {
        const anotherLiveQuote = await BookingQuote.exists({
          inquiryId: inquiry._id,
          _id: { $ne: quote._id },
          status: "sent",
          validUntil: { $gt: now },
        }).session(session);
        if (!anotherLiveQuote) {
          inquiry.status = "reviewing";
          await inquiry.save({ session });
        }
      }
      await addOutbox(
        "booking_quote",
        quote._id,
        "booking.quote.expired",
        {
          quoteId: quote.id,
          inquiryId: quote.inquiryId.toString(),
          ...(inquiry ? { customerId: inquiry.customerId.toString() } : {}),
        },
        session,
      );
      await recordAudit(
        {
          context: auditContext,
          action: "booking.quote.expired",
          entityType: "BookingQuote",
          entityId: quote._id,
          changes: {
            previousStatus,
            status: "expired",
            validUntil: quote.validUntil,
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

const expireDueQuotes = async (
  context: BookingRequestContext,
  limit = 100,
) =>
  expireDueQuotesCore({
    now: new Date(),
    limit,
    auditContext: context.audit,
    scope: requireStaffScope(context.actor),
  });

export const expireDueBookingQuotesForSystem = async (
  options: {
    now?: Date;
    limit?: number;
    workerId?: string;
  } = {},
) =>
  expireDueQuotesCore({
    now: options.now ?? new Date(),
    limit: options.limit ?? 100,
    auditContext: {
      actorType: "system",
      ...(options.workerId
        ? { requestId: `booking-lifecycle:${options.workerId}` }
        : {}),
    },
  });

export const inquiryService = {
  list,
  get,
  create,
  cancel,
  review,
  reject,
  createQuote,
  sendQuote,
  expireQuote,
  rejectQuote,
  expireDueQuotes,
};
