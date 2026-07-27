import { z } from "zod";

import { isValidLocalDate, timeToMinutes } from "../models/core/shared.js";
import {
  booleanQuerySchema,
  instantSchema,
  localDateSchema,
  objectIdSchema,
  paginationQuerySchema,
  timeSchema,
} from "./common.schemas.js";

const validLocalDateSchema = localDateSchema.refine(isValidLocalDate, {
  message: "Must be a real calendar date",
});

const nonEmptyPatch = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .partial()
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one field is required",
    });

const timeIntervalSchema = z
  .object({
    start: timeSchema,
    end: timeSchema,
  })
  .strict()
  .refine((interval) => timeToMinutes(interval.start) < timeToMinutes(interval.end), {
    message: "Interval end must be after its start",
    path: ["end"],
  });

const intervalsDoNotOverlap = (
  intervals: Array<{ start: string; end: string }>,
): boolean => {
  const sorted = [...intervals].sort(
    (left, right) => timeToMinutes(left.start) - timeToMinutes(right.start),
  );
  return sorted.every(
    (interval, index) =>
      index === 0 ||
      timeToMinutes(sorted[index - 1].end) <= timeToMinutes(interval.start),
  );
};

const employeeScheduleDaySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    shifts: z.array(timeIntervalSchema).max(12).default([]),
    breaks: z.array(timeIntervalSchema).max(12).default([]),
  })
  .strict()
  .superRefine((day, context) => {
    if (!intervalsDoNotOverlap(day.shifts)) {
      context.addIssue({
        code: "custom",
        path: ["shifts"],
        message: "Shifts cannot overlap",
      });
    }
    if (!intervalsDoNotOverlap(day.breaks)) {
      context.addIssue({
        code: "custom",
        path: ["breaks"],
        message: "Breaks cannot overlap",
      });
    }
    for (const [index, breakInterval] of day.breaks.entries()) {
      const isInsideShift = day.shifts.some(
        (shift) =>
          timeToMinutes(shift.start) <= timeToMinutes(breakInterval.start) &&
          timeToMinutes(breakInterval.end) <= timeToMinutes(shift.end),
      );
      if (!isInsideShift) {
        context.addIssue({
          code: "custom",
          path: ["breaks", index],
          message: "Every break must be inside a shift",
        });
      }
    }
  });

const employeeScheduleDaysSchema = z
  .array(employeeScheduleDaySchema)
  .length(7, "A schedule must define all seven weekdays")
  .superRefine((days, context) => {
    if (new Set(days.map((day) => day.dayOfWeek)).size !== 7) {
      context.addIssue({
        code: "custom",
        message: "Each weekday must appear exactly once",
      });
    }
  });

const scheduleStatusSchema = z.enum(["draft", "active", "archived"]);
const scheduleFields = {
  name: z.string().trim().min(2).max(100),
  effectiveFrom: validLocalDateSchema,
  effectiveUntil: validLocalDateSchema.nullish(),
  days: employeeScheduleDaysSchema,
  status: scheduleStatusSchema,
};

const scheduleChronology = (
  value: { effectiveFrom?: string; effectiveUntil?: string | null },
  context: z.RefinementCtx,
): void => {
  if (
    value.effectiveFrom &&
    value.effectiveUntil &&
    value.effectiveUntil <= value.effectiveFrom
  ) {
    context.addIssue({
      code: "custom",
      path: ["effectiveUntil"],
      message: "Effective end must be after effective start",
    });
  }
};

export const scheduleCollectionParamsSchema = z
  .object({
    branchId: objectIdSchema,
    employeeId: objectIdSchema,
  })
  .strict();

export const scheduleItemParamsSchema = scheduleCollectionParamsSchema
  .extend({ scheduleId: objectIdSchema })
  .strict();

export const createEmployeeScheduleBodySchema = z
  .object({
    ...scheduleFields,
    status: scheduleStatusSchema.default("draft"),
  })
  .strict()
  .superRefine(scheduleChronology);

export const updateEmployeeScheduleBodySchema = nonEmptyPatch(scheduleFields)
  .superRefine(scheduleChronology);

export const scheduleListQuerySchema = paginationQuerySchema
  .omit({ search: true, sort: true })
  .extend({
    status: scheduleStatusSchema.optional(),
    effectiveOn: validLocalDateSchema.optional(),
  })
  .strict();

const timeOffTypeSchema = z.enum([
  "vacation",
  "sick",
  "personal",
  "unpaid",
  "other",
]);
const timeOffStatusSchema = z.enum([
  "requested",
  "approved",
  "rejected",
  "cancelled",
]);

export const timeOffIdParamsSchema = z
  .object({ timeOffId: objectIdSchema })
  .strict();

export const createTimeOffBodySchema = z
  .object({
    allBranches: z.boolean().default(true),
    branchIds: z.array(objectIdSchema).max(100).default([]),
    type: timeOffTypeSchema,
    startAt: instantSchema,
    endAt: instantSchema,
    allDay: z.boolean().default(false),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endAt <= value.startAt) {
      context.addIssue({
        code: "custom",
        path: ["endAt"],
        message: "Time off must end after it starts",
      });
    }
    if (!value.allBranches && value.branchIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["branchIds"],
        message: "Select at least one branch or enable allBranches",
      });
    }
    if (value.allBranches && value.branchIds.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["branchIds"],
        message: "branchIds must be empty when allBranches is enabled",
      });
    }
  });

export const myTimeOffListQuerySchema = paginationQuerySchema
  .omit({ search: true, sort: true })
  .extend({
    status: timeOffStatusSchema.optional(),
    from: instantSchema.optional(),
    to: instantSchema.optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.to > value.from, {
    path: ["to"],
    message: "to must be after from",
  });

export const staffTimeOffListQuerySchema = myTimeOffListQuerySchema
  .extend({
    employeeId: objectIdSchema.optional(),
    branchId: objectIdSchema.optional(),
    type: timeOffTypeSchema.optional(),
  })
  .strict();

export const timeOffDecisionBodySchema = z
  .object({
    privateNote: z.string().trim().max(2000).optional(),
  })
  .strict();

const calendarBlockTypeSchema = z.enum([
  "branch_closed",
  "break",
  "meeting",
  "training",
  "maintenance",
  "travel",
  "manual",
  "other",
]);

const calendarBlockFields = {
  employeeId: objectIdSchema.nullish(),
  type: calendarBlockTypeSchema,
  title: z.string().trim().min(1).max(160),
  note: z.string().trim().max(2000).nullish(),
  startAt: instantSchema,
  endAt: instantSchema,
  allDay: z.boolean(),
  blocksBookings: z.boolean(),
};

const blockChronology = (
  value: {
    type?: z.infer<typeof calendarBlockTypeSchema>;
    employeeId?: string | null;
    startAt?: Date;
    endAt?: Date;
  },
  context: z.RefinementCtx,
): void => {
  if (value.startAt && value.endAt && value.endAt <= value.startAt) {
    context.addIssue({
      code: "custom",
      path: ["endAt"],
      message: "Calendar block must end after it starts",
    });
  }
  if (value.type === "branch_closed" && value.employeeId) {
    context.addIssue({
      code: "custom",
      path: ["employeeId"],
      message: "A branch closure cannot target one employee",
    });
  }
};

export const branchIdParamsSchema = z
  .object({ branchId: objectIdSchema })
  .strict();

export const calendarBlockIdParamsSchema = branchIdParamsSchema
  .extend({ blockId: objectIdSchema })
  .strict();

export const createCalendarBlockBodySchema = z
  .object({
    ...calendarBlockFields,
    allDay: z.boolean().default(false),
    blocksBookings: z.boolean().default(true),
  })
  .strict()
  .superRefine(blockChronology);

export const updateCalendarBlockBodySchema = nonEmptyPatch(calendarBlockFields)
  .superRefine(blockChronology);

export const calendarBlockListQuerySchema = paginationQuerySchema
  .omit({ search: true, sort: true })
  .extend({
    employeeId: objectIdSchema.optional(),
    from: instantSchema.optional(),
    to: instantSchema.optional(),
    activeOnly: booleanQuerySchema.default(true),
    blocksBookings: booleanQuerySchema.optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.to > value.from, {
    path: ["to"],
    message: "to must be after from",
  });

const resourceTypeSchema = z.enum(["chair", "room", "equipment"]);
const resourceFields = {
  type: resourceTypeSchema,
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  capacity: z.number().int().min(1).max(100),
  serviceIds: z.array(objectIdSchema).max(500),
  isActive: z.boolean(),
};

export const resourceIdParamsSchema = branchIdParamsSchema
  .extend({ resourceId: objectIdSchema })
  .strict();

export const createBookableResourceBodySchema = z
  .object({
    ...resourceFields,
    capacity: resourceFields.capacity.default(1),
    serviceIds: resourceFields.serviceIds.default([]),
    isActive: resourceFields.isActive.default(true),
  })
  .strict();

export const updateBookableResourceBodySchema = nonEmptyPatch(resourceFields);

export const bookableResourceListQuerySchema = paginationQuerySchema
  .omit({ sort: true })
  .extend({
    type: resourceTypeSchema.optional(),
    isActive: booleanQuerySchema.optional(),
    serviceId: objectIdSchema.optional(),
  })
  .strict();

export const availabilityQuerySchema = z
  .object({
    branchId: objectIdSchema,
    serviceId: objectIdSchema,
    date: validLocalDateSchema,
    employeeId: objectIdSchema.optional(),
    customerGender: z
      .enum(["male", "female", "other", "unspecified"])
      .optional(),
  })
  .strict();

export type CreateEmployeeScheduleBody = z.infer<
  typeof createEmployeeScheduleBodySchema
>;
export type UpdateEmployeeScheduleBody = z.infer<
  typeof updateEmployeeScheduleBodySchema
>;
export type ScheduleListQuery = z.infer<typeof scheduleListQuerySchema>;
export type CreateTimeOffBody = z.infer<typeof createTimeOffBodySchema>;
export type MyTimeOffListQuery = z.infer<typeof myTimeOffListQuerySchema>;
export type StaffTimeOffListQuery = z.infer<typeof staffTimeOffListQuerySchema>;
export type TimeOffDecisionBody = z.infer<typeof timeOffDecisionBodySchema>;
export type CreateCalendarBlockBody = z.infer<
  typeof createCalendarBlockBodySchema
>;
export type UpdateCalendarBlockBody = z.infer<
  typeof updateCalendarBlockBodySchema
>;
export type CalendarBlockListQuery = z.infer<
  typeof calendarBlockListQuerySchema
>;
export type CreateBookableResourceBody = z.infer<
  typeof createBookableResourceBodySchema
>;
export type UpdateBookableResourceBody = z.infer<
  typeof updateBookableResourceBodySchema
>;
export type BookableResourceListQuery = z.infer<
  typeof bookableResourceListQuerySchema
>;
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
