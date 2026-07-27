import { z } from "zod";

import {
  booleanQuerySchema,
  instantSchema,
  localDateSchema,
  objectIdSchema,
  paginationQuerySchema,
} from "./common.schemas.js";

const trimmedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalNullableText = (maximum: number) =>
  z.string().trim().max(maximum).optional().nullable();

const bookingItemInputSchema = z
  .object({
    serviceId: objectIdSchema,
    employeeId: objectIdSchema,
    startAt: instantSchema,
  })
  .strict();

const eventInputSchema = z
  .object({
    type: z.enum(["standard", "group", "wedding", "offsite"]).default("standard"),
    name: optionalNullableText(160),
    partySize: z.number().int().min(1).max(500).default(1),
    offsiteAddress: optionalNullableText(1000),
    travelMinutesBefore: z.number().int().min(0).max(1440).default(0),
    travelMinutesAfter: z.number().int().min(0).max(1440).default(0),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === "offsite" && !value.offsiteAddress) {
      context.addIssue({
        code: "custom",
        path: ["offsiteAddress"],
        message: "An off-site booking requires an address",
      });
    }
    if (
      value.type !== "offsite" &&
      (value.travelMinutesBefore > 0 || value.travelMinutesAfter > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["travelMinutesBefore"],
        message: "Travel buffers are supported only for off-site bookings",
      });
    }
  });

export const createBookingBodySchema = z
  .object({
    branchId: objectIdSchema,
    customerId: objectIdSchema.optional(),
    items: z.array(bookingItemInputSchema).min(1).max(50),
    waitlistEntryId: objectIdSchema.optional(),
    customerAcceptedVariablePricing: z.literal(true).optional(),
    customerNote: optionalNullableText(2000),
    internalNote: optionalNullableText(5000),
    event: eventInputSchema.optional(),
    source: z.enum(["admin", "walk_in"]).optional(),
  })
  .strict();

export const bookingIdParamsSchema = z
  .object({ bookingId: objectIdSchema })
  .strict();

export const bookingListQuerySchema = paginationQuerySchema
  .extend({
    branchId: objectIdSchema.optional(),
    customerId: objectIdSchema.optional(),
    employeeId: objectIdSchema.optional(),
    status: z
      .enum([
        "requested",
        "pending_advance",
        "confirmed",
        "checked_in",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ])
      .optional(),
    from: instantSchema.optional(),
    to: instantSchema.optional(),
    includeItems: booleanQuerySchema.optional().default(false),
  })
  .strict()
  .refine((query) => !query.from || !query.to || query.to > query.from, {
    path: ["to"],
    message: "The end of the range must be after its start",
  });

export const employeeBookingListQuerySchema = paginationQuerySchema
  .extend({
    status: z
      .enum([
        "requested",
        "pending_advance",
        "confirmed",
        "checked_in",
        "in_progress",
        "completed",
        "cancelled",
        "no_show",
      ])
      .optional(),
    from: instantSchema.optional(),
    to: instantSchema.optional(),
  })
  .strict()
  .refine((query) => !query.from || !query.to || query.to > query.from, {
    path: ["to"],
    message: "The end of the range must be after its start",
  });

export const cancelBookingBodySchema = z
  .object({
    reason: trimmedText(1000),
    overridePolicy: z.boolean().optional().default(false),
  })
  .strict();

export const rescheduleBookingBodySchema = z
  .object({
    items: z.array(bookingItemInputSchema).min(1).max(50),
    reason: optionalNullableText(1000),
    overridePolicy: z.boolean().optional().default(false),
  })
  .strict();

export const transitionBookingBodySchema = z
  .object({
    status: z.enum([
      "confirmed",
      "checked_in",
      "in_progress",
      "completed",
      "cancelled",
      "no_show",
    ]),
    reason: optionalNullableText(1000),
  })
  .strict();

export const externalSettlementBodySchema = z
  .object({
    status: z.enum(["not_tracked", "pending_external", "settled_external"]),
    externalReference: optionalNullableText(512),
    externallyReportedFinalAmountMinor: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .nullable(),
    settledAt: instantSchema.optional().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "settled_external" && !value.settledAt) {
      context.addIssue({
        code: "custom",
        path: ["settledAt"],
        message: "settledAt is required when externally settled",
      });
    }
  });

export const waitlistIdParamsSchema = z
  .object({ waitlistEntryId: objectIdSchema })
  .strict();

export const createWaitlistBodySchema = z
  .object({
    branchId: objectIdSchema,
    customerId: objectIdSchema.optional(),
    serviceIds: z.array(objectIdSchema).min(1).max(30),
    preferredEmployeeIds: z.array(objectIdSchema).max(30).optional().default([]),
    windowStartAt: instantSchema,
    windowEndAt: instantSchema,
    partySize: z.number().int().min(1).max(500).optional().default(1),
    priority: z.number().int().min(-100).max(100).optional(),
    note: optionalNullableText(1000),
    source: z.enum(["admin", "walk_in"]).optional(),
  })
  .strict()
  .refine((body) => body.windowEndAt > body.windowStartAt, {
    path: ["windowEndAt"],
    message: "Waitlist window must end after it starts",
  });

export const waitlistListQuerySchema = paginationQuerySchema
  .extend({
    branchId: objectIdSchema.optional(),
    customerId: objectIdSchema.optional(),
    status: z
      .enum(["waiting", "offered", "booked", "expired", "cancelled"])
      .optional(),
    serviceId: objectIdSchema.optional(),
    employeeId: objectIdSchema.optional(),
    fitsStartAt: instantSchema.optional(),
    fitsEndAt: instantSchema.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    const exactlyOne = Boolean(query.fitsStartAt) !== Boolean(query.fitsEndAt);
    if (exactlyOne) {
      context.addIssue({
        code: "custom",
        path: ["fitsEndAt"],
        message: "fitsStartAt and fitsEndAt must be supplied together",
      });
    }
    if (query.fitsStartAt && query.fitsEndAt && query.fitsEndAt <= query.fitsStartAt) {
      context.addIssue({
        code: "custom",
        path: ["fitsEndAt"],
        message: "Fit window must end after it starts",
      });
    }
  });

export const cancelWaitlistBodySchema = z
  .object({ reason: optionalNullableText(1000) })
  .strict();

export const offerWaitlistBodySchema = z
  .object({
    offeredUntil: instantSchema,
    note: optionalNullableText(1000),
  })
  .strict()
  .refine((body) => body.offeredUntil > new Date(), {
    path: ["offeredUntil"],
    message: "Offer expiry must be in the future",
  });

export const inquiryIdParamsSchema = z
  .object({ inquiryId: objectIdSchema })
  .strict();

export const createInquiryBodySchema = z
  .object({
    branchId: objectIdSchema.optional(),
    packageId: objectIdSchema.optional(),
    serviceIds: z.array(objectIdSchema).max(50).optional().default([]),
    productIds: z.array(objectIdSchema).max(50).optional().default([]),
    type: z.enum(["service", "product", "package", "wedding", "event"]),
    preferredDateFrom: localDateSchema.optional(),
    preferredDateTo: localDateSchema.optional(),
    partySize: z.number().int().min(1).max(500).optional().default(1),
    offsite: z.boolean().optional().default(false),
    venueAddress: optionalNullableText(1000),
    customerNote: optionalNullableText(5000),
  })
  .strict()
  .superRefine((body, context) => {
    if (!body.packageId && body.serviceIds.length === 0 && body.productIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["serviceIds"],
        message: "Select at least one package, service, or product",
      });
    }
    if (body.type !== "product" && !body.preferredDateFrom) {
      context.addIssue({
        code: "custom",
        path: ["preferredDateFrom"],
        message: "A preferred date is required",
      });
    }
    if (
      body.preferredDateFrom &&
      body.preferredDateTo &&
      body.preferredDateTo < body.preferredDateFrom
    ) {
      context.addIssue({
        code: "custom",
        path: ["preferredDateTo"],
        message: "Preferred end date cannot precede the start",
      });
    }
    if (body.offsite && !body.venueAddress) {
      context.addIssue({
        code: "custom",
        path: ["venueAddress"],
        message: "An off-site inquiry requires a venue address",
      });
    }
  });

export const inquiryListQuerySchema = paginationQuerySchema
  .extend({
    branchId: objectIdSchema.optional(),
    customerId: objectIdSchema.optional(),
    status: z
      .enum(["new", "reviewing", "quoted", "accepted", "declined", "expired", "cancelled"])
      .optional(),
    type: z.enum(["service", "product", "package", "wedding", "event"]).optional(),
  })
  .strict();

export const reviewInquiryBodySchema = z
  .object({
    assignedToUserId: objectIdSchema.optional().nullable(),
    internalNote: optionalNullableText(5000),
  })
  .strict();

export const rejectInquiryBodySchema = z
  .object({ reason: trimmedText(2000) })
  .strict();

const quoteLineSchema = z
  .object({
    type: z.enum(["service", "product", "custom"]),
    serviceId: objectIdSchema.optional(),
    productId: objectIdSchema.optional(),
    name: trimmedText(160).optional(),
    description: optionalNullableText(2000),
    quantity: z.number().int().min(1).max(500).default(1),
    durationMinutes: z.number().int().min(1).max(10_080).optional(),
    amountMinor: z.number().int().nonnegative(),
    employeeId: objectIdSchema.optional(),
  })
  .strict()
  .superRefine((line, context) => {
    if (line.type === "service" && (!line.serviceId || !line.durationMinutes)) {
      context.addIssue({
        code: "custom",
        path: ["serviceId"],
        message: "Service lines require a service and duration",
      });
    }
    if (line.type === "product" && !line.productId) {
      context.addIssue({
        code: "custom",
        path: ["productId"],
        message: "Product lines require a product",
      });
    }
    if (line.type === "custom" && !line.name) {
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: "Custom lines require a name",
      });
    }
  });

export const createQuoteBodySchema = z
  .object({
    branchId: objectIdSchema,
    validUntil: instantSchema,
    proposedStartAt: instantSchema.optional().nullable(),
    proposedEndAt: instantSchema.optional().nullable(),
    travelMinutesBefore: z.number().int().min(0).max(1440).default(0),
    travelMinutesAfter: z.number().int().min(0).max(1440).default(0),
    currency: z.string().trim().length(3).toUpperCase(),
    lines: z.array(quoteLineSchema).min(1).max(100),
    advanceRequirement: z.enum(["none", "optional", "required"]).default("none"),
    advanceDueMinor: z.number().int().nonnegative().default(0),
    terms: optionalNullableText(20_000),
    send: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((body, context) => {
    if (body.validUntil <= new Date()) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "Quote validity must be in the future",
      });
    }
    if (Boolean(body.proposedStartAt) !== Boolean(body.proposedEndAt)) {
      context.addIssue({
        code: "custom",
        path: ["proposedEndAt"],
        message: "Both proposed timestamps are required together",
      });
    }
    if (
      body.proposedStartAt &&
      body.proposedEndAt &&
      body.proposedEndAt <= body.proposedStartAt
    ) {
      context.addIssue({
        code: "custom",
        path: ["proposedEndAt"],
        message: "Proposed end must be after proposed start",
      });
    }
    if (body.advanceRequirement === "none" && body.advanceDueMinor !== 0) {
      context.addIssue({
        code: "custom",
        path: ["advanceDueMinor"],
        message: "No advance can be due when advances are disabled",
      });
    }
    if (body.advanceRequirement === "required" && body.advanceDueMinor === 0) {
      context.addIssue({
        code: "custom",
        path: ["advanceDueMinor"],
        message: "A required advance must be greater than zero",
      });
    }
  });

export const quoteIdParamsSchema = z
  .object({ quoteId: objectIdSchema })
  .strict();

export const quoteActionBodySchema = z
  .object({ reason: optionalNullableText(2000) })
  .strict();

export const scheduleAcceptedQuoteBodySchema = z
  .object({
    items: z.array(bookingItemInputSchema).min(1).max(50),
    internalNote: optionalNullableText(5000),
  })
  .strict();

export type CreateBookingBody = z.infer<typeof createBookingBodySchema>;
export type BookingListQuery = z.infer<typeof bookingListQuerySchema>;
export type EmployeeBookingListQuery = z.infer<
  typeof employeeBookingListQuerySchema
>;
export type CancelBookingBody = z.infer<typeof cancelBookingBodySchema>;
export type RescheduleBookingBody = z.infer<typeof rescheduleBookingBodySchema>;
export type TransitionBookingBody = z.infer<typeof transitionBookingBodySchema>;
export type ExternalSettlementBody = z.infer<typeof externalSettlementBodySchema>;
export type CreateWaitlistBody = z.infer<typeof createWaitlistBodySchema>;
export type WaitlistListQuery = z.infer<typeof waitlistListQuerySchema>;
export type OfferWaitlistBody = z.infer<typeof offerWaitlistBodySchema>;
export type CreateInquiryBody = z.infer<typeof createInquiryBodySchema>;
export type InquiryListQuery = z.infer<typeof inquiryListQuerySchema>;
export type ReviewInquiryBody = z.infer<typeof reviewInquiryBodySchema>;
export type RejectInquiryBody = z.infer<typeof rejectInquiryBodySchema>;
export type CreateQuoteBody = z.infer<typeof createQuoteBodySchema>;
export type ScheduleAcceptedQuoteBody = z.infer<
  typeof scheduleAcceptedQuoteBodySchema
>;
