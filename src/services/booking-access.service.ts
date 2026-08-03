import type { QueryFilter } from "mongoose";

import type { IBooking } from "../models/bookings/Booking.js";
import type { IBookingInquiry } from "../models/bookings/BookingInquiry.js";
import Customer from "../models/customers/Customer.js";
import type {
  BookingRequestActor,
  BookingStaffScope,
} from "../types/booking-api.js";
import { ApiError } from "../utils/ApiError.js";

export const requireCustomerForActor = async (
  actor: BookingRequestActor,
  requestedCustomerId?: string,
) => {
  if (actor.role === "customer") {
    const customer = await Customer.findOne({ userId: actor.userId });
    if (!customer || customer.status !== "active") {
      throw ApiError.forbidden(
        "An active customer profile is required",
        "CUSTOMER_PROFILE_INACTIVE",
      );
    }
    if (requestedCustomerId && !customer._id.equals(requestedCustomerId)) {
      throw ApiError.forbidden(
        "Customers cannot act for another customer",
        "CUSTOMER_OWNERSHIP_REQUIRED",
      );
    }
    return customer;
  }

  if (actor.role !== "admin" && actor.role !== "employee") {
    throw ApiError.forbidden("Booking access is not permitted", "BOOKING_ACCESS_FORBIDDEN");
  }
  if (!requestedCustomerId) {
    throw ApiError.badRequest(
      "customerId is required for a staff-created record",
      undefined,
      "CUSTOMER_ID_REQUIRED",
    );
  }
  const customer = await Customer.findById(requestedCustomerId);
  if (!customer || customer.status !== "active") {
    throw ApiError.notFound("An active customer was not found", "CUSTOMER_NOT_FOUND");
  }
  return customer;
};

export const requireStaffScope = (
  actor: BookingRequestActor,
): BookingStaffScope => {
  if (
    (actor.role !== "admin" && actor.role !== "employee") ||
    !actor.staffScope
  ) {
    throw ApiError.forbidden("Active staff access is required", "STAFF_ACCESS_REQUIRED");
  }
  return actor.staffScope;
};

export const assertBranchInScope = (
  branchId: string,
  scope: BookingStaffScope,
): void => {
  if (!scope.allBranches && !scope.branchIds.includes(branchId)) {
    throw ApiError.forbidden(
      "You do not have access to this branch",
      "BRANCH_ACCESS_FORBIDDEN",
    );
  }
};

export const scopeBookingFilter = (
  filter: QueryFilter<IBooking>,
  scope: BookingStaffScope,
): QueryFilter<IBooking> => {
  if (!scope.allBranches) filter.branchId = { $in: scope.branchIds };
  return filter;
};

export const scopeInquiryFilter = (
  filter: QueryFilter<IBookingInquiry>,
  scope: BookingStaffScope,
): QueryFilter<IBookingInquiry> => {
  if (!scope.allBranches) filter.branchId = { $in: scope.branchIds };
  return filter;
};

export const assertActorCanAccessBranch = (
  actor: BookingRequestActor,
  branchId: string,
): void => {
  if (actor.role === "customer") return;
  assertBranchInScope(branchId, requireStaffScope(actor));
};

export const schedulingGender = (
  gender: string,
): "male" | "female" | "other" | "unspecified" => {
  if (gender === "male" || gender === "female") return gender;
  if (gender === "unspecified") return "unspecified";
  return "other";
};

