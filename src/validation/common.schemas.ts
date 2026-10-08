import { z } from "zod";

import { normalizePhone } from "../models/core/shared.js";

export const objectIdSchema = z
  .string()
  .trim()
  .regex(/^[a-f\d]{24}$/i, "Must be a valid MongoDB ObjectId");

export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must use YYYY-MM-DD");

export const timeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Must use HH:mm");

export const instantSchema = z
  .string()
  .datetime({ offset: true, message: "Must be an ISO timestamp with Z or an explicit offset" })
  .transform((value) => new Date(value));

export const e164PhoneSchema = z
  .string()
  .trim()
  .transform((value) => normalizePhone(value) ?? "")
  .pipe(
    z.string().regex(
      /^\+[1-9]\d{7,14}$/,
      "Enter a valid mobile number, for example 0771234567 or +94771234567",
    ),
  )
  .meta({
    description:
      "Mobile number. Sri Lankan local form is accepted and stored as E.164.",
    examples: ["0771234567", "+94771234567"],
  });

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().max(1_000_000).default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().trim().max(100).optional(),
  search: z.string().trim().max(160).optional(),
});

export const idParamSchema = z.object({ id: objectIdSchema });

export const booleanQuerySchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true");
