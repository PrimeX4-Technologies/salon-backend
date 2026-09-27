import { z } from "zod";

import { emailSchema, e164PhoneSchema } from "./common.schemas.js";

const loginPasswordSchema = z
  .string()
  .min(1, "Password is required")
  .max(200)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password cannot exceed 72 UTF-8 bytes",
  );

const passwordSchema = z
  .string()
  .min(8, "Password must contain at least 8 characters")
  .max(200)
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "Password cannot exceed 72 UTF-8 bytes",
  );

export const newPasswordSchema = passwordSchema;

export const customerRegistrationSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: emailSchema.optional(),
    phone: e164PhoneSchema.optional(),
    password: newPasswordSchema,
  })
  .strict()
  .refine((value) => value.email || value.phone, {
    message: "An email address or mobile number is required",
    path: ["email"],
  });

export const loginSchema = z
  .object({
    identifier: z.string().trim().min(3).max(254),
    password: loginPasswordSchema,
  })
  .strict();

export const googleLoginSchema = z
  .object({
    idToken: z.string().trim().min(100).max(10_000),
  })
  .strict();

export const refreshTokenSchema = z
  .object({
    refreshToken: z.string().trim().min(1).max(10_000).optional(),
  })
  .strict()
  .default({});

export const changePasswordSchema = z
  .object({
    currentPassword: loginPasswordSchema.optional(),
    newPassword: newPasswordSchema,
  })
  .strict()
  .refine(
    (value) => !value.currentPassword || value.currentPassword !== value.newPassword,
    {
    message: "New password must be different from the current password",
    path: ["newPassword"],
    },
  );

export const forgotPasswordSchema = z
  .object({
    identifier: z.string().trim().min(3).max(254),
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().trim().min(32).max(512),
    newPassword: newPasswordSchema,
  })
  .strict();

export const confirmEmailSchema = z
  .object({
    token: z.string().trim().min(32).max(512),
  })
  .strict();

export const sessionParamSchema = z.object({
  sessionId: z.string().uuid(),
});

export type CustomerRegistrationInput = z.infer<typeof customerRegistrationSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ConfirmEmailInput = z.infer<typeof confirmEmailSchema>;
