import type { RequestHandler } from "express";
import mongoose, { type HydratedDocument } from "mongoose";

import StaffAccess, {
  type IStaffAccess,
  type StaffPermission,
} from "../../models/access/StaffAccess.js";
import type { UserRole } from "../../models/auth/User.js";
import { ApiError } from "../../utils/ApiError.js";
import { catchAsync } from "../../utils/catchAsync.js";

const requireAuthContext = (
  req: Express.Request,
): NonNullable<Express.Request["auth"]> => {
  if (!req.auth || !req.user) {
    throw ApiError.unauthorized("Authentication is required", "AUTHENTICATION_REQUIRED");
  }
  return req.auth;
};

export const authorizeRoles = (...allowedRoles: UserRole[]): RequestHandler => {
  const allowed = new Set(allowedRoles);
  return (req, _res, next): void => {
    try {
      const auth = requireAuthContext(req);
      if (!allowed.has(auth.role)) {
        throw ApiError.forbidden(
          "Your account role cannot perform this action",
          "ROLE_FORBIDDEN",
        );
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

export const requirePermissions = (
  ...requiredPermissions: StaffPermission[]
): RequestHandler =>
  catchAsync(async (req, res, next) => {
    const auth = requireAuthContext(req);
    if (auth.role !== "admin" && auth.role !== "employee") {
      throw ApiError.forbidden(
        "Staff access is required",
        "STAFF_ACCESS_REQUIRED",
      );
    }

    const access = await StaffAccess.findOne({
      userId: auth.userId,
      status: "active",
    });
    if (!access) {
      throw ApiError.forbidden(
        "Your staff access is not active",
        "STAFF_ACCESS_INACTIVE",
      );
    }

    const granted = new Set(access.permissions);
    const missing = requiredPermissions.filter((permission) => !granted.has(permission));
    if (missing.length > 0) {
      throw new ApiError(403, "Required staff permission is missing", {
        code: "PERMISSION_FORBIDDEN",
        details: { missingPermissions: missing },
      });
    }

    res.locals.staffAccess = access;
    next();
  });

export const requireBranchAccess = (fieldName = "branchId"): RequestHandler =>
  catchAsync(async (req, res, next) => {
    const auth = requireAuthContext(req);
    if (auth.role !== "admin" && auth.role !== "employee") {
      throw ApiError.forbidden(
        "Staff access is required",
        "STAFF_ACCESS_REQUIRED",
      );
    }

    const candidate =
      req.params[fieldName] ??
      (req.body as Record<string, unknown> | undefined)?.[fieldName] ??
      req.query[fieldName];
    const branchId = typeof candidate === "string" ? candidate : undefined;
    if (!branchId || !mongoose.isValidObjectId(branchId)) {
      throw ApiError.badRequest(
        `A valid ${fieldName} is required`,
        undefined,
        "INVALID_BRANCH_ID",
      );
    }

    const cachedAccess = res.locals.staffAccess as
      | HydratedDocument<IStaffAccess>
      | undefined;
    const access =
      cachedAccess ??
      (await StaffAccess.findOne({ userId: auth.userId, status: "active" }));
    if (!access) {
      throw ApiError.forbidden(
        "Your staff access is not active",
        "STAFF_ACCESS_INACTIVE",
      );
    }

    if (
      !access.allBranches &&
      !access.branchIds.some((allowedBranchId) => allowedBranchId.equals(branchId))
    ) {
      throw ApiError.forbidden(
        "You do not have access to this branch",
        "BRANCH_ACCESS_FORBIDDEN",
      );
    }

    res.locals.staffAccess = access;
    next();
  });
