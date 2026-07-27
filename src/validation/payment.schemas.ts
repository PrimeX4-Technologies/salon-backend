import { z } from "zod";

import {
  instantSchema,
  objectIdSchema,
  paginationQuerySchema,
} from "./common.schemas.js";

const providerSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);

export const paymentIdParamsSchema = z
  .object({ paymentId: objectIdSchema })
  .strict();

export const paymentWebhookParamsSchema = z
  .object({ provider: providerSchema })
  .strict();

export const createAdvanceCheckoutBodySchema = z
  .object({
    bookingId: objectIdSchema,
    provider: providerSchema.refine((provider) => provider !== "manual", {
      message: "Online checkout requires a configured payment provider",
    }),
    amountMinor: z.number().int().positive().optional(),
  })
  .strict();

export const webhookEventIdParamsSchema = z
  .object({ webhookEventId: objectIdSchema })
  .strict();

export const webhookEventListQuerySchema = paginationQuerySchema
  .extend({
    provider: providerSchema.optional(),
    status: z
      .enum(["received", "processing", "failed"])
      .optional()
      .default("failed"),
  })
  .strict();

export const paymentListQuerySchema = paginationQuerySchema
  .extend({
    branchId: objectIdSchema.optional(),
    bookingId: objectIdSchema.optional(),
    customerId: objectIdSchema.optional(),
    purpose: z
      .enum([
        "advance",
        "advance_refund",
        "cancellation_fee",
        "no_show_fee",
      ])
      .optional(),
    status: z
      .enum([
        "pending",
        "authorized",
        "succeeded",
        "failed",
        "cancelled",
        "refunded",
      ])
      .optional(),
    provider: providerSchema.optional(),
    from: instantSchema.optional(),
    to: instantSchema.optional(),
  })
  .strict()
  .refine((query) => !query.from || !query.to || query.to > query.from, {
    path: ["to"],
    message: "The end of the range must be after its start",
  });

export const customerPaymentListQuerySchema = paginationQuerySchema
  .extend({
    bookingId: objectIdSchema.optional(),
    status: z
      .enum(["pending", "authorized", "succeeded", "failed", "cancelled", "refunded"])
      .optional(),
  })
  .strict();

export const recordAdvanceBodySchema = z
  .object({
    bookingId: objectIdSchema,
    provider: providerSchema.default("manual"),
    merchantAccountId: z.string().trim().min(1).max(255).optional(),
    providerTransactionId: z.string().trim().min(1).max(255).optional(),
    amountMinor: z.number().int().positive(),
    currency: currencySchema,
    paymentMethodType: z
      .enum(["card", "bank_transfer", "cash", "wallet", "external"])
      .optional(),
    processedAt: instantSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provider !== "manual" && !value.providerTransactionId) {
      context.addIssue({
        code: "custom",
        path: ["providerTransactionId"],
        message: "External providers require a transaction ID",
      });
    }
    if (
      value.provider === "manual" &&
      value.paymentMethodType &&
      !["cash", "bank_transfer", "external"].includes(value.paymentMethodType)
    ) {
      context.addIssue({
        code: "custom",
        path: ["paymentMethodType"],
        message: "Manual records support cash, bank transfer, or external methods",
      });
    }
  });

export const recordRefundBodySchema = z
  .object({
    provider: providerSchema.default("manual"),
    merchantAccountId: z.string().trim().min(1).max(255).optional(),
    providerTransactionId: z.string().trim().min(1).max(255).optional(),
    amountMinor: z.number().int().positive(),
    currency: currencySchema,
    paymentMethodType: z
      .enum(["card", "bank_transfer", "cash", "wallet", "external"])
      .optional(),
    processedAt: instantSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provider !== "manual" && !value.providerTransactionId) {
      context.addIssue({
        code: "custom",
        path: ["providerTransactionId"],
        message: "External providers require a refund transaction ID",
      });
    }
  });

export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;
export type CustomerPaymentListQuery = z.infer<
  typeof customerPaymentListQuerySchema
>;
export type RecordAdvanceBody = z.infer<typeof recordAdvanceBodySchema>;
export type RecordRefundBody = z.infer<typeof recordRefundBodySchema>;
export type CreateAdvanceCheckoutBody = z.infer<
  typeof createAdvanceCheckoutBodySchema
>;
export type WebhookEventListQuery = z.infer<
  typeof webhookEventListQuerySchema
>;
