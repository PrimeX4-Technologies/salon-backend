import type { Request, Response } from "express";

import type { IStaffAccess } from "../../models/access/StaffAccess.js";
import { bookingService } from "../../services/booking.service.js";
import { inquiryService } from "../../services/inquiry.service.js";
import { waitlistService } from "../../services/waitlist.service.js";
import type { BookingRequestContext } from "../../types/booking-api.js";
import { ApiError } from "../../utils/ApiError.js";
import { catchAsync } from "../../utils/catchAsync.js";
import {
  sendCreated,
  sendPaginated,
  sendSuccess,
} from "../../utils/httpResponse.js";
import type {
  BookingListQuery,
  CancelBookingBody,
  CreateBookingBody,
  CreateInquiryBody,
  CreateQuoteBody,
  CreateWaitlistBody,
  EmployeeBookingListQuery,
  ExternalSettlementBody,
  InquiryListQuery,
  OfferWaitlistBody,
  RejectInquiryBody,
  RescheduleBookingBody,
  ReviewInquiryBody,
  ScheduleAcceptedQuoteBody,
  TransitionBookingBody,
  WaitlistListQuery,
} from "../../validation/booking.schemas.js";
import {
  getAuditContext,
  getValidatedParam,
} from "./request-audit-context.js";

const requestContext = (req: Request, res: Response): BookingRequestContext => {
  if (!req.auth) {
    throw ApiError.unauthorized("Authentication is required", "AUTHENTICATION_REQUIRED");
  }
  const access = res.locals.staffAccess as IStaffAccess | undefined;
  return {
    actor: {
      userId: req.auth.userId,
      role: req.auth.role,
      ...(access
        ? {
            staffScope: {
              allBranches: access.allBranches,
              branchIds: access.branchIds.map((branchId) => branchId.toString()),
            },
          }
        : {}),
    },
    audit: getAuditContext(req, res),
  };
};

const idempotencyKey = (req: Request): string | undefined =>
  req.get("idempotency-key");

export const createBooking = catchAsync(async (req, res) => {
  const result = await bookingService.create(
    req.body as CreateBookingBody,
    idempotencyKey(req),
    requestContext(req, res),
  );
  if (result.replayed) {
    sendSuccess(res, result.aggregate, 200, { idempotentReplay: true });
    return;
  }
  sendCreated(res, result.aggregate);
});

export const listBookings = catchAsync(async (req, res) => {
  const result = await bookingService.list(
    req.query as unknown as BookingListQuery,
    requestContext(req, res),
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getBooking = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await bookingService.get(
      getValidatedParam(req, "bookingId"),
      requestContext(req, res),
    ),
  );
});

export const listMyEmployeeBookings = catchAsync(async (req, res) => {
  const result = await bookingService.listMyEmployeeBookings(
    req.query as unknown as EmployeeBookingListQuery,
    requestContext(req, res),
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getMyEmployeeBooking = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await bookingService.getMyEmployeeBooking(
      getValidatedParam(req, "bookingId"),
      requestContext(req, res),
    ),
  );
});

export const cancelBooking = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await bookingService.cancel(
      getValidatedParam(req, "bookingId"),
      req.body as CancelBookingBody,
      requestContext(req, res),
    ),
  );
});

export const rescheduleBooking = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await bookingService.reschedule(
      getValidatedParam(req, "bookingId"),
      req.body as RescheduleBookingBody,
      requestContext(req, res),
    ),
  );
});

export const transitionBooking = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await bookingService.transition(
      getValidatedParam(req, "bookingId"),
      req.body as TransitionBookingBody,
      requestContext(req, res),
    ),
  );
});

export const updateBookingExternalSettlement = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await bookingService.updateExternalSettlement(
      getValidatedParam(req, "bookingId"),
      req.body as ExternalSettlementBody,
      requestContext(req, res),
    ),
  );
});

export const expireBookingHolds = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await bookingService.expireDueHolds(requestContext(req, res)),
  );
});

export const createWaitlistEntry = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await waitlistService.create(
      req.body as CreateWaitlistBody,
      requestContext(req, res),
    ),
  );
});

export const listWaitlistEntries = catchAsync(async (req, res) => {
  const result = await waitlistService.list(
    req.query as unknown as WaitlistListQuery,
    requestContext(req, res),
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getWaitlistEntry = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await waitlistService.get(
      getValidatedParam(req, "waitlistEntryId"),
      requestContext(req, res),
    ),
  );
});

export const cancelWaitlistEntry = catchAsync(async (req, res) => {
  const body = req.body as { reason?: string | null };
  sendSuccess(
    res,
    await waitlistService.cancel(
      getValidatedParam(req, "waitlistEntryId"),
      body.reason ?? undefined,
      requestContext(req, res),
    ),
  );
});

export const offerWaitlistEntry = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await waitlistService.offer(
      getValidatedParam(req, "waitlistEntryId"),
      req.body as OfferWaitlistBody,
      requestContext(req, res),
    ),
  );
});

export const expireWaitlistEntries = catchAsync(async (req, res) => {
  sendSuccess(res, await waitlistService.expireDue(requestContext(req, res)));
});

export const createInquiry = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await inquiryService.create(
      req.body as CreateInquiryBody,
      requestContext(req, res),
    ),
  );
});

export const listInquiries = catchAsync(async (req, res) => {
  const result = await inquiryService.list(
    req.query as unknown as InquiryListQuery,
    requestContext(req, res),
  );
  sendPaginated(res, result.items, result.pagination);
});

export const getInquiry = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await inquiryService.get(
      getValidatedParam(req, "inquiryId"),
      requestContext(req, res),
    ),
  );
});

export const cancelInquiry = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await inquiryService.cancel(
      getValidatedParam(req, "inquiryId"),
      requestContext(req, res),
    ),
  );
});

export const reviewInquiry = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await inquiryService.review(
      getValidatedParam(req, "inquiryId"),
      req.body as ReviewInquiryBody,
      requestContext(req, res),
    ),
  );
});

export const rejectInquiry = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await inquiryService.reject(
      getValidatedParam(req, "inquiryId"),
      req.body as RejectInquiryBody,
      requestContext(req, res),
    ),
  );
});

export const createQuote = catchAsync(async (req, res) => {
  sendCreated(
    res,
    await inquiryService.createQuote(
      getValidatedParam(req, "inquiryId"),
      req.body as CreateQuoteBody,
      requestContext(req, res),
    ),
  );
});

export const sendQuote = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await inquiryService.sendQuote(
      getValidatedParam(req, "quoteId"),
      requestContext(req, res),
    ),
  );
});

export const expireQuote = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await inquiryService.expireQuote(
      getValidatedParam(req, "quoteId"),
      requestContext(req, res),
    ),
  );
});

export const expireQuotes = catchAsync(async (req, res) => {
  sendSuccess(res, await inquiryService.expireDueQuotes(requestContext(req, res)));
});

export const acceptQuote = catchAsync(async (req, res) => {
  sendSuccess(
    res,
    await bookingService.acceptQuote(
      getValidatedParam(req, "quoteId"),
      idempotencyKey(req),
      requestContext(req, res),
    ),
  );
});

export const rejectQuote = catchAsync(async (req, res) => {
  const body = req.body as { reason?: string | null };
  sendSuccess(
    res,
    await inquiryService.rejectQuote(
      getValidatedParam(req, "quoteId"),
      body.reason ?? undefined,
      requestContext(req, res),
    ),
  );
});

export const scheduleAcceptedQuote = catchAsync(async (req, res) => {
  const result = await bookingService.scheduleAcceptedQuote(
    getValidatedParam(req, "quoteId"),
    req.body as ScheduleAcceptedQuoteBody,
    idempotencyKey(req),
    requestContext(req, res),
  );
  if (result.idempotentReplay) {
    sendSuccess(res, result, 200, { idempotentReplay: true });
    return;
  }
  sendCreated(res, result);
});

export const bookingController = {
  createBooking,
  listBookings,
  getBooking,
  listMyEmployeeBookings,
  getMyEmployeeBooking,
  cancelBooking,
  rescheduleBooking,
  transitionBooking,
  updateBookingExternalSettlement,
  expireBookingHolds,
  createWaitlistEntry,
  listWaitlistEntries,
  getWaitlistEntry,
  cancelWaitlistEntry,
  offerWaitlistEntry,
  expireWaitlistEntries,
  createInquiry,
  listInquiries,
  getInquiry,
  cancelInquiry,
  reviewInquiry,
  rejectInquiry,
  createQuote,
  sendQuote,
  expireQuote,
  expireQuotes,
  acceptQuote,
  rejectQuote,
  scheduleAcceptedQuote,
};
