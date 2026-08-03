import type { Request, Response } from "express";

import type { UserRole } from "../../models/auth/User.js";
import type { StaffBranchScope } from "../../services/operational-access.js";
import { ApiError } from "../../utils/ApiError.js";

export const requireOperationalAuth = (
  req: Request,
): { userId: string; role: UserRole } => {
  if (!req.auth) {
    throw ApiError.unauthorized(
      "Authentication is required",
      "AUTHENTICATION_REQUIRED",
    );
  }
  return req.auth;
};

export const getOperationalStaffScope = (
  res: Response,
): StaffBranchScope => {
  const scope: unknown = res.locals.staffAccess;
  if (!scope || typeof scope !== "object") {
    throw ApiError.forbidden(
      "Active staff access is required",
      "STAFF_ACCESS_REQUIRED",
    );
  }
  return scope as StaffBranchScope;
};

export const getIdempotencyKey = (req: Request): string => {
  const value = req.get("idempotency-key")?.trim();
  if (!value || value.length < 8 || value.length > 200) {
    throw ApiError.badRequest(
      "Idempotency-Key header must contain 8 to 200 characters",
      undefined,
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  }
  return value;
};

