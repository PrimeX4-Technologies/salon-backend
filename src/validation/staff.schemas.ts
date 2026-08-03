import { z } from "zod";

import { STAFF_PERMISSIONS } from "../models/access/StaffAccess.js";
import { PRICE_MODES } from "../models/core/pricing.js";
import { isValidLocalDate } from "../models/core/shared.js";
import { newPasswordSchema } from "./auth.schemas.js";
import {
  booleanQuerySchema,
  e164PhoneSchema,
  emailSchema,
  localDateSchema,
  objectIdSchema,
  paginationQuerySchema,
} from "./common.schemas.js";

const employmentTypeSchema = z.enum([
  "full_time",
  "part_time",
  "contractor",
  "temporary",
]);
const employeeStatusSchema = z.enum([
  "invited",
  "active",
  "on_leave",
  "inactive",
  "terminated",
]);
const proficiencySchema = z.enum([
  "trainee",
  "qualified",
  "advanced",
  "expert",
]);
const staffAccessStatusSchema = z.enum([
  "invited",
  "active",
  "suspended",
  "revoked",
]);
const clientGenderSchema = z.enum(["male", "female", "all"]);
const validLocalDateSchema = localDateSchema.refine(isValidLocalDate, {
  message: "Must be a real calendar date",
});
const nullableObjectIdSchema = objectIdSchema.nullish();
const moneySchema = z.number().int().nonnegative();

export const localStaffAccountSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: emailSchema.optional(),
    phone: e164PhoneSchema.optional(),
    password: newPasswordSchema,
    avatarUrl: z.string().trim().url().max(2048).nullish(),
  })
  .strict()
  .refine((value) => Boolean(value.email || value.phone), {
    message: "An email address or E.164 mobile number is required",
    path: ["email"],
  });

export const staffAccessBodySchema = z
  .object({
    permissions: z.array(z.enum(STAFF_PERMISSIONS)).max(STAFF_PERMISSIONS.length),
    allBranches: z.boolean(),
    branchIds: z.array(objectIdSchema).max(100).default([]),
    status: staffAccessStatusSchema.default("active"),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.allBranches && value.branchIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["branchIds"],
        message: "At least one branch is required when allBranches is false",
      });
    }
  });

export const employeeIdParamsSchema = z
  .object({ employeeId: objectIdSchema })
  .strict();
export const adminIdParamsSchema = z
  .object({ adminId: objectIdSchema })
  .strict();
export const skillIdParamsSchema = z
  .object({ skillId: objectIdSchema })
  .strict();
export const levelIdParamsSchema = z
  .object({ levelId: objectIdSchema })
  .strict();
export const employeeSkillParamsSchema = z
  .object({
    employeeId: objectIdSchema,
    skillId: objectIdSchema,
  })
  .strict();
export const employeeServiceParamsSchema = z
  .object({
    employeeId: objectIdSchema,
    serviceId: objectIdSchema,
    branchId: objectIdSchema,
  })
  .strict();

export const employeeListQuerySchema = paginationQuerySchema
  .omit({ sort: true })
  .extend({
    status: employeeStatusSchema.optional(),
    employmentType: employmentTypeSchema.optional(),
    branchId: objectIdSchema.optional(),
    levelId: objectIdSchema.optional(),
    isBookable: booleanQuerySchema.optional(),
  })
  .strict();

const employeeProfileFields = {
  employeeCode: z.string().trim().min(1).max(32),
  name: z.string().trim().min(2).max(160),
  title: z.string().trim().min(1).max(100).nullish(),
  levelId: nullableObjectIdSchema,
  workEmail: emailSchema.nullish(),
  workPhone: e164PhoneSchema.nullish(),
  branchIds: z.array(objectIdSchema).max(100),
  primaryBranchId: nullableObjectIdSchema,
  employmentType: employmentTypeSchema,
  status: employeeStatusSchema,
  isBookable: z.boolean(),
  acceptsOnlineBookings: z.boolean(),
  servesClientGender: clientGenderSchema,
  maxConcurrentClients: z.number().int().min(1).max(5),
  bio: z.string().trim().max(2000).nullish(),
  avatarUrl: z.string().trim().url().max(2048).nullish(),
  calendarColor: z
    .string()
    .trim()
    .regex(/^#[0-9A-F]{6}$/i)
    .transform((value) => value.toUpperCase()),
  hireDate: validLocalDateSchema.nullish(),
  terminationDate: validLocalDateSchema.nullish(),
};

export const createEmployeeBodySchema = z
  .object({
    ...employeeProfileFields,
    employmentType: employmentTypeSchema.default("full_time"),
    status: employeeStatusSchema.default("invited"),
    isBookable: z.boolean().default(false),
    acceptsOnlineBookings: z.boolean().default(false),
    servesClientGender: clientGenderSchema.default("all"),
    maxConcurrentClients: z.number().int().min(1).max(5).default(1),
    calendarColor: employeeProfileFields.calendarColor.default("#2563EB"),
    branchIds: z.array(objectIdSchema).max(100).default([]),
    account: localStaffAccountSchema.optional(),
    access: staffAccessBodySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.access && !value.account) {
      context.addIssue({
        code: "custom",
        path: ["access"],
        message: "Access can be created only when an account is supplied",
      });
    }
    if (value.status === "active" && !value.account) {
      context.addIssue({
        code: "custom",
        path: ["account"],
        message: "An active employee requires a local-login account",
      });
    }
    if (
      value.access?.status === "active" &&
      value.status !== "active" &&
      value.status !== "on_leave"
    ) {
      context.addIssue({
        code: "custom",
        path: ["access", "status"],
        message:
          "Active staff access requires an active or on-leave employee",
      });
    }
  });

export const provisionEmployeeAccountBodySchema = z
  .object({
    account: localStaffAccountSchema,
    access: staffAccessBodySchema,
    activateEmployee: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.activateEmployee && value.access.status !== "active") {
      context.addIssue({
        code: "custom",
        path: ["access", "status"],
        message: "Activating the employee requires active staff access",
      });
    }
    if (!value.activateEmployee && value.access.status === "active") {
      context.addIssue({
        code: "custom",
        path: ["access", "status"],
        message:
          "Active staff access cannot be provisioned without activating the employee",
      });
    }
  });

export const updateEmployeeBodySchema = z
  .object(employeeProfileFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const updateMyEmployeeProfileBodySchema = z
  .object({
    bio: z.string().trim().max(2000).nullish(),
    avatarUrl: z.string().trim().url().max(2048).nullish(),
    calendarColor: employeeProfileFields.calendarColor.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const employeeServiceListQuerySchema = z
  .object({ branchId: objectIdSchema.optional() })
  .strict();

const durationSchema = z
  .object({
    applicationMinutes: z.number().int().min(0).max(1440),
    processingMinutes: z.number().int().min(0).max(1440).default(0),
    finishingMinutes: z.number().int().min(0).max(1440).default(0),
    bufferMinutes: z.number().int().min(0).max(240).default(0),
    processingBlocksEmployee: z.boolean().default(true),
  })
  .strict()
  .refine(
    (value) =>
      value.applicationMinutes +
        value.processingMinutes +
        value.finishingMinutes +
        value.bufferMinutes >
      0,
    { message: "Total duration must be positive" },
  );

const pricePresentationSchema = z
  .object({
    mode: z.enum(PRICE_MODES),
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default("LKR"),
    amountMinor: moneySchema.optional(),
    fromAmountMinor: moneySchema.optional(),
    toAmountMinor: moneySchema.optional(),
    label: z.string().trim().max(120).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === "fixed" && value.amountMinor === undefined) {
      context.addIssue({
        code: "custom",
        path: ["amountMinor"],
        message: "A fixed price requires amountMinor",
      });
    }
    if (value.mode === "starting_from" && value.fromAmountMinor === undefined) {
      context.addIssue({
        code: "custom",
        path: ["fromAmountMinor"],
        message: "A starting-from price requires fromAmountMinor",
      });
    }
    if (
      value.mode === "range" &&
      (value.fromAmountMinor === undefined || value.toAmountMinor === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fromAmountMinor"],
        message: "A range requires both endpoints",
      });
    }
    if (
      value.mode === "range" &&
      value.fromAmountMinor !== undefined &&
      value.toAmountMinor !== undefined &&
      value.toAmountMinor < value.fromAmountMinor
    ) {
      context.addIssue({
        code: "custom",
        path: ["toAmountMinor"],
        message: "Range maximum cannot be below its minimum",
      });
    }
  });

export const upsertEmployeeSkillBodySchema = z
  .object({
    proficiency: proficiencySchema.default("qualified"),
    certifiedAt: validLocalDateSchema.nullish(),
    expiresAt: validLocalDateSchema.nullish(),
    isActive: z.boolean().default(true),
  })
  .strict();

export const upsertEmployeeServiceBodySchema = z
  .object({
    proficiency: proficiencySchema.default("qualified"),
    priceOverride: pricePresentationSchema.nullish(),
    durationOverride: durationSchema.nullish(),
    servesClientGenderOverride: clientGenderSchema.nullish(),
    isActive: z.boolean().default(true),
    isOnlineBookable: z.boolean().default(true),
    validFrom: validLocalDateSchema.nullish(),
    validUntil: validLocalDateSchema.nullish(),
  })
  .strict();

export const createSkillBodySchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    code: z.string().trim().min(1).max(32),
    description: z.string().trim().max(1000).nullish(),
    isActive: z.boolean().default(true),
  })
  .strict();
export const updateSkillBodySchema = createSkillBodySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const createLevelBodySchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    code: z.string().trim().min(1).max(24),
    rank: z.number().int().min(0).max(1000),
    isActive: z.boolean().default(true),
  })
  .strict();
export const updateLevelBodySchema = createLevelBodySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const activeOnlyQuerySchema = z
  .object({ activeOnly: booleanQuerySchema.optional().default(false) })
  .strict();

export const adminListQuerySchema = paginationQuerySchema
  .omit({ sort: true })
  .extend({ isActive: booleanQuerySchema.optional() })
  .strict();

export const createAdminBodySchema = z
  .object({
    account: localStaffAccountSchema,
    access: staffAccessBodySchema,
  })
  .strict();

export const updateAdminBodySchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    avatarUrl: z.string().trim().url().max(2048).nullish(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export type LocalStaffAccountInput = z.infer<typeof localStaffAccountSchema>;
export type StaffAccessInput = z.infer<typeof staffAccessBodySchema>;
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;
export type CreateEmployeeBody = z.infer<typeof createEmployeeBodySchema>;
export type UpdateEmployeeBody = z.infer<typeof updateEmployeeBodySchema>;
export type ProvisionEmployeeAccountBody = z.infer<
  typeof provisionEmployeeAccountBodySchema
>;
export type UpdateMyEmployeeProfileBody = z.infer<
  typeof updateMyEmployeeProfileBodySchema
>;
export type UpsertEmployeeSkillBody = z.infer<
  typeof upsertEmployeeSkillBodySchema
>;
export type UpsertEmployeeServiceBody = z.infer<
  typeof upsertEmployeeServiceBodySchema
>;
export type CreateSkillBody = z.infer<typeof createSkillBodySchema>;
export type UpdateSkillBody = z.infer<typeof updateSkillBodySchema>;
export type CreateLevelBody = z.infer<typeof createLevelBodySchema>;
export type UpdateLevelBody = z.infer<typeof updateLevelBodySchema>;
export type AdminListQuery = z.infer<typeof adminListQuerySchema>;
export type CreateAdminBody = z.infer<typeof createAdminBodySchema>;
export type UpdateAdminBody = z.infer<typeof updateAdminBodySchema>;
