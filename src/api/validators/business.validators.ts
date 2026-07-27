import { z } from "zod";

const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Must be a valid MongoDB ObjectId");

const optionalBooleanQuery = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

const paginationQuery = {
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
};

const addressSchema = z
  .object({
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    postalCode: z.string().trim().max(32).optional(),
    countryCode: z.string().trim().length(2).toUpperCase().optional(),
  })
  .strict();

const profileFields = {
  name: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(200).optional(),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  status: z.enum(["active", "inactive", "closed"]).optional(),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "Phone must use E.164 format")
    .optional(),
  websiteUrl: z.string().trim().url().max(2048).optional(),
  logoUrl: z.string().trim().url().max(2048).optional(),
  registeredAddress: addressSchema.optional(),
};

const advancePolicySchema = z
  .object({
    requirement: z.enum(["none", "optional", "required"]),
    calculation: z.enum(["none", "fixed", "percentage"]),
    fixedAmountMinor: z.number().int().nonnegative().optional(),
    percentage: z.number().min(0).max(100).optional(),
    basis: z.enum(["estimate", "accepted_quote"]).default("estimate"),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.requirement === "none" && value.calculation !== "none") {
      context.addIssue({
        code: "custom",
        path: ["calculation"],
        message: "An advance with requirement 'none' must use calculation 'none'",
      });
    }
    if (value.requirement !== "none" && value.calculation === "none") {
      context.addIssue({
        code: "custom",
        path: ["calculation"],
        message: "Optional and required advances need a calculation method",
      });
    }
    if (
      value.calculation === "fixed" &&
      (value.fixedAmountMinor === undefined || value.fixedAmountMinor <= 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fixedAmountMinor"],
        message: "A fixed advance must be greater than zero",
      });
    }
    if (
      value.calculation === "percentage" &&
      (value.percentage === undefined || value.percentage <= 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["percentage"],
        message: "An advance percentage must be greater than zero",
      });
    }
  });

const bookingSettingsSchema = z
  .object({
    slotIntervalMinutes: z.number().int().min(5).max(120).optional(),
    minimumNoticeMinutes: z.number().int().min(0).max(525_600).optional(),
    maximumAdvanceDays: z.number().int().min(1).max(730).optional(),
    temporaryHoldMinutes: z.number().int().min(1).max(60).optional(),
    cancellationWindowHours: z.number().int().min(0).max(720).optional(),
    allowWalkIns: z.boolean().optional(),
    allowWaitlist: z.boolean().optional(),
    allowProcessingOverlap: z.boolean().optional(),
  })
  .strict();

const customerAuthSettingsSchema = z
  .object({
    emailPasswordEnabled: z.boolean().optional(),
    phonePasswordEnabled: z.boolean().optional(),
    googleEnabled: z.boolean().optional(),
  })
  .strict();

const reminderSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    leadMinutes: z.array(z.number().int().positive().max(525_600)).max(20).optional(),
    channels: z
      .array(z.enum(["email", "sms", "whatsapp", "push"]))
      .min(1)
      .max(4)
      .optional(),
  })
  .strict();

const branchFields = {
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(2).max(24),
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{7,14}$/, "Phone must use E.164 format")
    .optional(),
  address: addressSchema.optional(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
  bookingsEnabled: z.boolean().optional(),
};

const timeIntervalSchema = z
  .object({
    start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict();

const branchHoursDaySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    isClosed: z.boolean(),
    intervals: z.array(timeIntervalSchema).max(8),
  })
  .strict();

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD");

const branchHoursFields = {
  name: z.string().trim().min(1).max(100),
  effectiveFrom: localDateSchema,
  effectiveUntil: localDateSchema.optional().nullable(),
  days: z.array(branchHoursDaySchema).length(7),
  status: z.enum(["draft", "active", "archived"]).optional(),
};

export const businessProfileUpdateSchema = z.object({
  body: z.object(profileFields).strict(),
});

export const businessSettingsUpdateSchema = z.object({
  body: z
    .object({
      branchMode: z.enum(["single", "multiple"]).optional(),
      primaryBranchId: objectIdSchema.optional(),
      locale: z.string().trim().min(2).max(20).optional(),
      currency: z.string().trim().length(3).toUpperCase().optional(),
      finalPaymentHandling: z.enum(["at_salon", "external_system"]).optional(),
      booking: bookingSettingsSchema.optional(),
      customerAuth: customerAuthSettingsSchema.optional(),
      defaultAdvance: advancePolicySchema.optional(),
      reminders: reminderSettingsSchema.optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, "At least one setting is required"),
});

export const businessBootstrapSchema = z.object({
  body: z
    .object({
      profile: z.object(profileFields).strict(),
      primaryBranch: z
        .object({
          ...branchFields,
          isPrimary: z.literal(true).optional(),
          isActive: z.literal(true).optional(),
        })
        .strict(),
      settings: z
        .object({
          branchMode: z.enum(["single", "multiple"]).optional(),
          locale: z.string().trim().min(2).max(20).optional(),
          currency: z.string().trim().length(3).toUpperCase().optional(),
          finalPaymentHandling: z.enum(["at_salon", "external_system"]).optional(),
          booking: bookingSettingsSchema.optional(),
          customerAuth: customerAuthSettingsSchema.optional(),
          defaultAdvance: advancePolicySchema.optional(),
          reminders: reminderSettingsSchema.optional(),
        })
        .strict()
        .optional(),
    })
    .strict(),
});

export const branchIdParamsSchema = z.object({
  params: z.object({ branchId: objectIdSchema }).strict(),
});

export const branchCreateSchema = z.object({
  body: z.object(branchFields).strict(),
});

export const branchUpdateSchema = z.object({
  params: z.object({ branchId: objectIdSchema }).strict(),
  body: z
    .object({
      name: branchFields.name.optional(),
      code: branchFields.code.optional(),
      email: branchFields.email.nullable(),
      phone: branchFields.phone.nullable(),
      address: branchFields.address.nullable(),
      isPrimary: branchFields.isPrimary,
      isActive: branchFields.isActive,
      bookingsEnabled: branchFields.bookingsEnabled,
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, "At least one field is required"),
});

export const branchListSchema = z.object({
  query: z
    .object({
      ...paginationQuery,
      search: z.string().trim().max(160).optional(),
      isActive: optionalBooleanQuery,
      bookingsEnabled: optionalBooleanQuery,
    })
    .strict(),
});

export const branchHoursIdParamsSchema = z.object({
  params: z
    .object({
      branchId: objectIdSchema,
      hoursId: objectIdSchema,
    })
    .strict(),
});

export const branchHoursCreateSchema = z.object({
  params: z.object({ branchId: objectIdSchema }).strict(),
  body: z.object(branchHoursFields).strict(),
});

export const branchHoursUpdateSchema = z.object({
  params: z
    .object({
      branchId: objectIdSchema,
      hoursId: objectIdSchema,
    })
    .strict(),
  body: z
    .object({
      name: branchHoursFields.name.optional(),
      effectiveFrom: branchHoursFields.effectiveFrom.optional(),
      effectiveUntil: branchHoursFields.effectiveUntil,
      days: branchHoursFields.days.optional(),
      status: branchHoursFields.status,
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, "At least one field is required"),
});

export const branchHoursListSchema = z.object({
  params: z.object({ branchId: objectIdSchema }).strict(),
  query: z
    .object({
      ...paginationQuery,
      status: z.enum(["draft", "active", "archived"]).optional(),
      effectiveOn: localDateSchema.optional(),
    })
    .strict(),
});

export const currentBranchHoursSchema = z.object({
  params: z.object({ branchId: objectIdSchema }).strict(),
  query: z
    .object({
      effectiveOn: localDateSchema.optional(),
    })
    .strict(),
});

export type BusinessProfileInput = z.infer<
  typeof businessProfileUpdateSchema
>["body"];
export type BusinessSettingsInput = z.infer<
  typeof businessSettingsUpdateSchema
>["body"];
export type BusinessBootstrapInput = z.infer<typeof businessBootstrapSchema>["body"];
export type BranchCreateInput = z.infer<typeof branchCreateSchema>["body"];
export type BranchUpdateInput = z.infer<typeof branchUpdateSchema>["body"];
export type BranchHoursCreateInput = z.infer<typeof branchHoursCreateSchema>["body"];
export type BranchHoursUpdateInput = z.infer<typeof branchHoursUpdateSchema>["body"];
