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

const fixedPriceSchema = z
  .object({
    mode: z.literal("fixed"),
    currency: z.string().trim().length(3).toUpperCase().default("LKR"),
    amountMinor: z.number().int().nonnegative(),
    label: z.string().trim().max(120).optional(),
  })
  .strict();

const startingFromPriceSchema = z
  .object({
    mode: z.literal("starting_from"),
    currency: z.string().trim().length(3).toUpperCase().default("LKR"),
    fromAmountMinor: z.number().int().nonnegative(),
    label: z.string().trim().max(120).optional(),
  })
  .strict();

const rangePriceSchema = z
  .object({
    mode: z.literal("range"),
    currency: z.string().trim().length(3).toUpperCase().default("LKR"),
    fromAmountMinor: z.number().int().nonnegative(),
    toAmountMinor: z.number().int().nonnegative(),
    label: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((price) => price.toAmountMinor >= price.fromAmountMinor, {
    path: ["toAmountMinor"],
    message: "Range maximum cannot be below its minimum",
  });

const quoteRequiredPriceSchema = z
  .object({
    mode: z.literal("quote_required"),
    currency: z.string().trim().length(3).toUpperCase().default("LKR"),
    label: z.string().trim().max(120).optional(),
  })
  .strict();

const priceSchema = z.discriminatedUnion("mode", [
  fixedPriceSchema,
  startingFromPriceSchema,
  rangePriceSchema,
  quoteRequiredPriceSchema,
]);

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

const categoryFields = {
  parentId: objectIdSchema.optional().nullable(),
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(1000).optional(),
  appliesTo: z.array(z.enum(["service", "product", "package"])).min(1).max(3).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
};

const durationSchema = z
  .object({
    applicationMinutes: z.number().int().min(0).max(1440),
    processingMinutes: z.number().int().min(0).max(1440).optional(),
    finishingMinutes: z.number().int().min(0).max(1440).optional(),
    bufferMinutes: z.number().int().min(0).max(240).optional(),
    processingBlocksEmployee: z.boolean().optional(),
  })
  .strict()
  .refine(
    (duration) =>
      duration.applicationMinutes +
        (duration.processingMinutes ?? 0) +
        (duration.finishingMinutes ?? 0) +
        (duration.bufferMinutes ?? 0) >
      0,
    "Total service duration must be positive",
  );

const serviceFields = {
  categoryId: objectIdSchema,
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(5000).optional(),
  targetClientGender: z.enum(["male", "female", "all"]).optional(),
  requiredSkillIds: z.array(objectIdSchema).max(100).optional(),
  duration: durationSchema,
  price: priceSchema,
  tierPrices: z
    .array(
      z
        .object({
          employeeLevelId: objectIdSchema,
          price: priceSchema,
        })
        .strict(),
    )
    .max(100)
    .optional(),
  advancePolicy: advancePolicySchema.optional().nullable(),
  bookingMode: z.enum(["instant", "request", "consultation_required"]).optional(),
  isActive: z.boolean().optional(),
  isOnlineBookable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
};

const productFields = {
  categoryId: objectIdSchema,
  branchIds: z.array(objectIdSchema).max(100).optional(),
  availableAtAllBranches: z.boolean().optional(),
  code: z.string().trim().min(1).max(40),
  sku: z.string().trim().max(80).optional(),
  barcode: z.string().trim().max(80).optional(),
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  brand: z.string().trim().max(120).optional(),
  description: z.string().trim().max(5000).optional(),
  imageUrls: z.array(z.string().trim().url().max(2048)).max(20).optional(),
  price: priceSchema,
  purchaseMode: z.enum(["in_store", "external_link", "inquiry"]).optional(),
  externalPurchaseUrl: z.string().trim().url().max(2048).optional(),
  isActive: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
};

const packageFields = {
  categoryId: objectIdSchema,
  branchIds: z.array(objectIdSchema).max(100).optional(),
  availableAtAllBranches: z.boolean().optional(),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(10_000).optional(),
  kind: z.enum(["bundle", "wedding", "event"]).optional(),
  bookingMode: z.enum(["request_quote", "consultation_required"]).optional(),
  minimumPartySize: z.number().int().min(1).max(500).optional(),
  maximumPartySize: z.number().int().min(1).max(500).optional().nullable(),
  allowsOffsite: z.boolean().optional(),
  travelMinutesBefore: z.number().int().min(0).max(1440).optional(),
  travelMinutesAfter: z.number().int().min(0).max(1440).optional(),
  serviceComponents: z
    .array(
      z
        .object({
          serviceId: objectIdSchema,
          quantity: z.number().int().min(1).max(100),
          isOptional: z.boolean().optional(),
        })
        .strict(),
    )
    .min(1)
    .max(100),
  productInclusions: z
    .array(
      z
        .object({
          productId: objectIdSchema,
          quantity: z.number().int().min(1).max(100),
          isOptional: z.boolean().optional(),
        })
        .strict(),
    )
    .max(100)
    .optional(),
  price: priceSchema,
  advancePolicy: advancePolicySchema.optional().nullable(),
  isActive: z.boolean().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
};

const branchServiceFields = {
  branchId: objectIdSchema,
  serviceId: objectIdSchema,
  priceOverride: priceSchema.optional().nullable(),
  durationOverride: durationSchema.optional().nullable(),
  advancePolicyOverride: advancePolicySchema.optional().nullable(),
  isActive: z.boolean().optional(),
  isOnlineBookable: z.boolean().optional(),
};

const catalogIdParams = (key: string) =>
  z.object({ [key]: objectIdSchema }).strict();

const patchSchema = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .refine((body) => Object.keys(body).length > 0, "At least one field is required");

export const categoryIdSchema = z.object({ params: catalogIdParams("categoryId") });
export const categoryCreateSchema = z.object({ body: z.object(categoryFields).strict() });
export const categoryUpdateSchema = z.object({
  params: catalogIdParams("categoryId"),
  body: patchSchema({
    parentId: categoryFields.parentId,
    name: categoryFields.name.optional(),
    slug: categoryFields.slug.optional(),
    description: categoryFields.description.nullable(),
    appliesTo: categoryFields.appliesTo,
    sortOrder: categoryFields.sortOrder,
    isActive: categoryFields.isActive,
  }),
});

export const serviceIdSchema = z.object({ params: catalogIdParams("serviceId") });
export const serviceDetailSchema = z.object({
  params: catalogIdParams("serviceId"),
  query: z.object({ branchId: objectIdSchema.optional() }).strict(),
});
export const serviceCreateSchema = z.object({ body: z.object(serviceFields).strict() });
export const serviceUpdateSchema = z.object({
  params: catalogIdParams("serviceId"),
  body: patchSchema({
    categoryId: serviceFields.categoryId.optional(),
    code: serviceFields.code.optional(),
    name: serviceFields.name.optional(),
    slug: serviceFields.slug.optional(),
    description: serviceFields.description.nullable(),
    targetClientGender: serviceFields.targetClientGender,
    requiredSkillIds: serviceFields.requiredSkillIds,
    duration: serviceFields.duration.optional(),
    price: serviceFields.price.optional(),
    tierPrices: serviceFields.tierPrices,
    advancePolicy: serviceFields.advancePolicy,
    bookingMode: serviceFields.bookingMode,
    isActive: serviceFields.isActive,
    isOnlineBookable: serviceFields.isOnlineBookable,
    sortOrder: serviceFields.sortOrder,
  }),
});

export const productIdSchema = z.object({ params: catalogIdParams("productId") });
export const productCreateSchema = z.object({ body: z.object(productFields).strict() });
export const productUpdateSchema = z.object({
  params: catalogIdParams("productId"),
  body: patchSchema({
    categoryId: productFields.categoryId.optional(),
    branchIds: productFields.branchIds,
    availableAtAllBranches: productFields.availableAtAllBranches,
    code: productFields.code.optional(),
    sku: productFields.sku.nullable(),
    barcode: productFields.barcode.nullable(),
    name: productFields.name.optional(),
    slug: productFields.slug.optional(),
    brand: productFields.brand.nullable(),
    description: productFields.description.nullable(),
    imageUrls: productFields.imageUrls,
    price: productFields.price.optional(),
    purchaseMode: productFields.purchaseMode,
    externalPurchaseUrl: productFields.externalPurchaseUrl.nullable(),
    isActive: productFields.isActive,
    isPublished: productFields.isPublished,
    sortOrder: productFields.sortOrder,
  }),
});

export const packageIdSchema = z.object({ params: catalogIdParams("packageId") });
export const packageCreateSchema = z.object({ body: z.object(packageFields).strict() });
export const packageUpdateSchema = z.object({
  params: catalogIdParams("packageId"),
  body: patchSchema({
    categoryId: packageFields.categoryId.optional(),
    branchIds: packageFields.branchIds,
    availableAtAllBranches: packageFields.availableAtAllBranches,
    code: packageFields.code.optional(),
    name: packageFields.name.optional(),
    slug: packageFields.slug.optional(),
    description: packageFields.description.nullable(),
    kind: packageFields.kind,
    bookingMode: packageFields.bookingMode,
    minimumPartySize: packageFields.minimumPartySize,
    maximumPartySize: packageFields.maximumPartySize,
    allowsOffsite: packageFields.allowsOffsite,
    travelMinutesBefore: packageFields.travelMinutesBefore,
    travelMinutesAfter: packageFields.travelMinutesAfter,
    serviceComponents: packageFields.serviceComponents.optional(),
    productInclusions: packageFields.productInclusions,
    price: packageFields.price.optional(),
    advancePolicy: packageFields.advancePolicy,
    isActive: packageFields.isActive,
    isPublished: packageFields.isPublished,
    sortOrder: packageFields.sortOrder,
  }),
});

export const branchServiceIdSchema = z.object({
  params: catalogIdParams("branchServiceId"),
});
export const branchServiceCreateSchema = z.object({
  body: z.object(branchServiceFields).strict(),
});
export const branchServiceUpdateSchema = z.object({
  params: catalogIdParams("branchServiceId"),
  body: patchSchema({
    branchId: branchServiceFields.branchId.optional(),
    serviceId: branchServiceFields.serviceId.optional(),
    priceOverride: branchServiceFields.priceOverride,
    durationOverride: branchServiceFields.durationOverride,
    advancePolicyOverride: branchServiceFields.advancePolicyOverride,
    isActive: branchServiceFields.isActive,
    isOnlineBookable: branchServiceFields.isOnlineBookable,
  }),
});

export const catalogListSchema = z.object({
  query: z
    .object({
      ...paginationQuery,
      search: z.string().trim().max(160).optional(),
      categoryId: objectIdSchema.optional(),
      branchId: objectIdSchema.optional(),
      isActive: optionalBooleanQuery,
      isPublished: optionalBooleanQuery,
      isOnlineBookable: optionalBooleanQuery,
    })
    .strict(),
});

export const categoryListSchema = z.object({
  query: z
    .object({
      ...paginationQuery,
      search: z.string().trim().max(160).optional(),
      parentId: objectIdSchema.optional(),
      appliesTo: z.enum(["service", "product", "package"]).optional(),
      isActive: optionalBooleanQuery,
    })
    .strict(),
});

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>["body"];
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>["body"];
export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>["body"];
export type ServiceUpdateInput = z.infer<typeof serviceUpdateSchema>["body"];
export type ProductCreateInput = z.infer<typeof productCreateSchema>["body"];
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>["body"];
export type PackageCreateInput = z.infer<typeof packageCreateSchema>["body"];
export type PackageUpdateInput = z.infer<typeof packageUpdateSchema>["body"];
export type BranchServiceCreateInput = z.infer<typeof branchServiceCreateSchema>["body"];
export type BranchServiceUpdateInput = z.infer<typeof branchServiceUpdateSchema>["body"];
