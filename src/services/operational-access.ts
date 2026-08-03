import type { Types } from "mongoose";

import type { IStaffAccess } from "../models/access/StaffAccess.js";
import { ApiError } from "../utils/ApiError.js";

export type StaffBranchScope = Pick<
  IStaffAccess,
  "allBranches" | "branchIds"
>;

export const canAccessOperationalBranch = (
  scope: StaffBranchScope,
  branchId: string | Types.ObjectId,
): boolean =>
  scope.allBranches ||
  scope.branchIds.some((allowed) => allowed.equals(branchId));

export const assertOperationalBranchAccess = (
  scope: StaffBranchScope,
  branchId: string | Types.ObjectId,
): void => {
  if (!canAccessOperationalBranch(scope, branchId)) {
    throw ApiError.forbidden(
      "You do not have access to this branch",
      "BRANCH_ACCESS_FORBIDDEN",
    );
  }
};

