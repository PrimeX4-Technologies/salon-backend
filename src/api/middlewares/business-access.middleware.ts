import type { RequestHandler, Response } from "express";

import type { IStaffAccess } from "../../models/access/StaffAccess.js";
import BranchService from "../../models/catalog/BranchService.js";
import { ApiError } from "../../utils/ApiError.js";
import { catchAsync } from "../../utils/catchAsync.js";

type StaffAccessScope = Pick<IStaffAccess, "allBranches" | "branchIds">;

const getStaffAccess = (res: Response): StaffAccessScope => {
  const candidate: unknown = res.locals.staffAccess;
  if (!candidate || typeof candidate !== "object") {
    throw ApiError.forbidden("Active staff access is required", "STAFF_ACCESS_REQUIRED");
  }
  return candidate as StaffAccessScope;
};

const canAccessBranch = (
  access: StaffAccessScope,
  branchId: string,
): boolean =>
  access.allBranches ||
  access.branchIds.some((allowedBranchId) => allowedBranchId.equals(branchId));

export const requireAllBranchAccess: RequestHandler = (_req, res, next) => {
  try {
    const access = getStaffAccess(res);
    if (!access.allBranches) {
      throw ApiError.forbidden(
        "Access to every branch is required for this operation",
        "ALL_BRANCH_ACCESS_REQUIRED",
      );
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireBranchServiceAccess: RequestHandler = catchAsync(
  async (req, res, next) => {
    const access = getStaffAccess(res);
    const rawId = req.params.branchServiceId;
    const branchServiceId = Array.isArray(rawId) ? rawId[0] : rawId;
    const branchService = await BranchService.findById(branchServiceId).select(
      "branchId",
    );
    if (!branchService) {
      throw ApiError.notFound("Branch service not found", "BRANCH_SERVICE_NOT_FOUND");
    }

    const currentBranchId = branchService.branchId.toString();
    if (!canAccessBranch(access, currentBranchId)) {
      throw ApiError.forbidden(
        "You do not have access to this branch",
        "BRANCH_ACCESS_FORBIDDEN",
      );
    }

    const rawBody: unknown = req.body;
    const requestedBranchId =
      rawBody &&
      typeof rawBody === "object" &&
      "branchId" in rawBody &&
      typeof rawBody.branchId === "string"
        ? rawBody.branchId
        : undefined;
    if (requestedBranchId && !canAccessBranch(access, requestedBranchId)) {
      throw ApiError.forbidden(
        "You do not have access to the target branch",
        "BRANCH_ACCESS_FORBIDDEN",
      );
    }

    next();
  },
);
