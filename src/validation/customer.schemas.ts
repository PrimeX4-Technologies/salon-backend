import { z } from "zod";

import { isValidLocalDate } from "../models/core/shared.js";
import {
  e164PhoneSchema,
  emailSchema,
  localDateSchema,
  objectIdSchema,
  paginationQuerySchema,
} from "./common.schemas.js";

const customerGenderSchema = z.enum([
  "male",
  "female",
  "non_binary",
  "prefer_not_to_say",
  "unspecified",
]);
const customerStatusSchema = z.enum(["active", "blocked", "archived"]);
const customerSourceSchema = z.enum([
  "online",
  "admin",
  "walk_in",
  "erp_import",
  "api",
]);
const validLocalDateSchema = localDateSchema.refine(isValidLocalDate, {
  message: "Must be a real calendar date",
});

const optionalReferenceSchema = objectIdSchema.nullish();
const optionalEmailSchema = emailSchema.nullish();
const optionalPhoneSchema = e164PhoneSchema.nullish();

export const customerIdParamsSchema = z
  .object({ customerId: objectIdSchema })
  .strict();

export const customerListQuerySchema = paginationQuerySchema
  .omit({ sort: true })
  .extend({
    status: customerStatusSchema.optional(),
    source: customerSourceSchema.optional(),
    preferredBranchId: objectIdSchema.optional(),
  })
  .strict();

export const createCustomerBodySchema = z
  .object({
    userId: optionalReferenceSchema,
    name: z.string().trim().min(2).max(160),
    preferredName: z.string().trim().min(1).max(80).nullish(),
    email: optionalEmailSchema,
    phone: optionalPhoneSchema,
    gender: customerGenderSchema.default("unspecified"),
    dateOfBirth: validLocalDateSchema.nullish(),
    preferredBranchId: optionalReferenceSchema,
    preferredEmployeeId: optionalReferenceSchema,
    tags: z.array(z.string().trim().min(1).max(40)).max(50).default([]),
    internalNotes: z.string().trim().max(5000).nullish(),
    source: customerSourceSchema.default("admin"),
    status: customerStatusSchema.default("active"),
  })
  .strict();

export const updateCustomerBodySchema = createCustomerBodySchema
  .omit({ userId: true, source: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export const updateMyCustomerProfileBodySchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    preferredName: z.string().trim().min(1).max(80).nullish(),
    gender: customerGenderSchema.optional(),
    dateOfBirth: validLocalDateSchema.nullish(),
    preferredBranchId: optionalReferenceSchema,
    preferredEmployeeId: optionalReferenceSchema,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export type CreateCustomerBody = z.infer<typeof createCustomerBodySchema>;
export type UpdateCustomerBody = z.infer<typeof updateCustomerBodySchema>;
export type UpdateMyCustomerProfileBody = z.infer<
  typeof updateMyCustomerProfileBodySchema
>;
