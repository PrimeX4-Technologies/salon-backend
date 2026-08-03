import { Router } from "express";

import {
  acceptQuote,
  cancelBooking,
  cancelInquiry,
  cancelWaitlistEntry,
  createBooking,
  createInquiry,
  createQuote,
  createWaitlistEntry,
  expireBookingHolds,
  expireQuote,
  expireQuotes,
  expireWaitlistEntries,
  getBooking,
  getInquiry,
  getMyEmployeeBooking,
  getWaitlistEntry,
  listBookings,
  listInquiries,
  listMyEmployeeBookings,
  listWaitlistEntries,
  offerWaitlistEntry,
  rejectInquiry,
  rejectQuote,
  rescheduleBooking,
  reviewInquiry,
  scheduleAcceptedQuote,
  sendQuote,
  transitionBooking,
  updateBookingExternalSettlement,
} from "../controllers/booking.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import {
  authorizeRoles,
  requirePermissions,
} from "../middlewares/role.middleware.js";
import { validate } from "../middlewares/validate.middleware.js";
import {
  bookingIdParamsSchema,
  bookingListQuerySchema,
  cancelBookingBodySchema,
  cancelWaitlistBodySchema,
  createBookingBodySchema,
  createInquiryBodySchema,
  createQuoteBodySchema,
  createWaitlistBodySchema,
  externalSettlementBodySchema,
  employeeBookingListQuerySchema,
  inquiryIdParamsSchema,
  inquiryListQuerySchema,
  offerWaitlistBodySchema,
  quoteActionBodySchema,
  quoteIdParamsSchema,
  rejectInquiryBodySchema,
  rescheduleBookingBodySchema,
  reviewInquiryBodySchema,
  scheduleAcceptedQuoteBodySchema,
  transitionBookingBodySchema,
  waitlistIdParamsSchema,
  waitlistListQuerySchema,
} from "../../validation/booking.schemas.js";

/**
 * Mount at `/api/v1/customer`. Every record is scoped to the authenticated
 * customer profile; customerId and private snapshot fields are never trusted.
 */
export const customerBookingRouter = Router();
customerBookingRouter.use(authenticate, authorizeRoles("customer"));

customerBookingRouter.get(
  "/bookings",
  validate({ query: bookingListQuerySchema }),
  listBookings,
);
customerBookingRouter.post(
  "/bookings",
  validate({ body: createBookingBodySchema }),
  createBooking,
);
customerBookingRouter.get(
  "/bookings/:bookingId",
  validate({ params: bookingIdParamsSchema }),
  getBooking,
);
customerBookingRouter.post(
  "/bookings/:bookingId/cancel",
  validate({
    params: bookingIdParamsSchema,
    body: cancelBookingBodySchema,
  }),
  cancelBooking,
);
customerBookingRouter.post(
  "/bookings/:bookingId/reschedule",
  validate({
    params: bookingIdParamsSchema,
    body: rescheduleBookingBodySchema,
  }),
  rescheduleBooking,
);

customerBookingRouter.get(
  "/waitlist",
  validate({ query: waitlistListQuerySchema }),
  listWaitlistEntries,
);
customerBookingRouter.post(
  "/waitlist",
  validate({ body: createWaitlistBodySchema }),
  createWaitlistEntry,
);
customerBookingRouter.get(
  "/waitlist/:waitlistEntryId",
  validate({ params: waitlistIdParamsSchema }),
  getWaitlistEntry,
);
customerBookingRouter.post(
  "/waitlist/:waitlistEntryId/cancel",
  validate({
    params: waitlistIdParamsSchema,
    body: cancelWaitlistBodySchema,
  }),
  cancelWaitlistEntry,
);

customerBookingRouter.get(
  "/inquiries",
  validate({ query: inquiryListQuerySchema }),
  listInquiries,
);
customerBookingRouter.post(
  "/inquiries",
  validate({ body: createInquiryBodySchema }),
  createInquiry,
);
customerBookingRouter.get(
  "/inquiries/:inquiryId",
  validate({ params: inquiryIdParamsSchema }),
  getInquiry,
);
customerBookingRouter.post(
  "/inquiries/:inquiryId/cancel",
  validate({ params: inquiryIdParamsSchema }),
  cancelInquiry,
);
customerBookingRouter.post(
  "/quotes/:quoteId/accept",
  validate({ params: quoteIdParamsSchema }),
  acceptQuote,
);
customerBookingRouter.post(
  "/quotes/:quoteId/reject",
  validate({
    params: quoteIdParamsSchema,
    body: quoteActionBodySchema,
  }),
  rejectQuote,
);

/**
 * Mount at `/api/v1/staff`. `requirePermissions` loads StaffAccess once and
 * every service operation reapplies its branch scope to prevent IDOR.
 */
export const staffBookingRouter = Router();
staffBookingRouter.use(
  authenticate,
  authorizeRoles("admin", "employee"),
  requirePermissions("manage_bookings"),
);

staffBookingRouter.get(
  "/bookings",
  validate({ query: bookingListQuerySchema }),
  listBookings,
);
staffBookingRouter.post(
  "/bookings",
  validate({ body: createBookingBodySchema }),
  createBooking,
);
staffBookingRouter.post("/bookings/expire-holds", expireBookingHolds);
staffBookingRouter.get(
  "/bookings/:bookingId",
  validate({ params: bookingIdParamsSchema }),
  getBooking,
);
staffBookingRouter.post(
  "/bookings/:bookingId/cancel",
  validate({
    params: bookingIdParamsSchema,
    body: cancelBookingBodySchema,
  }),
  cancelBooking,
);
staffBookingRouter.post(
  "/bookings/:bookingId/reschedule",
  validate({
    params: bookingIdParamsSchema,
    body: rescheduleBookingBodySchema,
  }),
  rescheduleBooking,
);
staffBookingRouter.post(
  "/bookings/:bookingId/transition",
  validate({
    params: bookingIdParamsSchema,
    body: transitionBookingBodySchema,
  }),
  transitionBooking,
);
staffBookingRouter.put(
  "/bookings/:bookingId/external-settlement",
  validate({
    params: bookingIdParamsSchema,
    body: externalSettlementBodySchema,
  }),
  updateBookingExternalSettlement,
);

staffBookingRouter.get(
  "/waitlist",
  validate({ query: waitlistListQuerySchema }),
  listWaitlistEntries,
);
staffBookingRouter.post(
  "/waitlist",
  validate({ body: createWaitlistBodySchema }),
  createWaitlistEntry,
);
staffBookingRouter.post("/waitlist/expire-due", expireWaitlistEntries);
staffBookingRouter.get(
  "/waitlist/:waitlistEntryId",
  validate({ params: waitlistIdParamsSchema }),
  getWaitlistEntry,
);
staffBookingRouter.post(
  "/waitlist/:waitlistEntryId/cancel",
  validate({
    params: waitlistIdParamsSchema,
    body: cancelWaitlistBodySchema,
  }),
  cancelWaitlistEntry,
);
staffBookingRouter.post(
  "/waitlist/:waitlistEntryId/offer",
  validate({
    params: waitlistIdParamsSchema,
    body: offerWaitlistBodySchema,
  }),
  offerWaitlistEntry,
);

staffBookingRouter.get(
  "/inquiries",
  validate({ query: inquiryListQuerySchema }),
  listInquiries,
);
staffBookingRouter.get(
  "/inquiries/:inquiryId",
  validate({ params: inquiryIdParamsSchema }),
  getInquiry,
);
staffBookingRouter.post(
  "/inquiries/:inquiryId/review",
  validate({
    params: inquiryIdParamsSchema,
    body: reviewInquiryBodySchema,
  }),
  reviewInquiry,
);
staffBookingRouter.post(
  "/inquiries/:inquiryId/reject",
  validate({
    params: inquiryIdParamsSchema,
    body: rejectInquiryBodySchema,
  }),
  rejectInquiry,
);
staffBookingRouter.post(
  "/inquiries/:inquiryId/quotes",
  validate({
    params: inquiryIdParamsSchema,
    body: createQuoteBodySchema,
  }),
  createQuote,
);
staffBookingRouter.post("/quotes/expire-due", expireQuotes);
staffBookingRouter.post(
  "/quotes/:quoteId/send",
  validate({ params: quoteIdParamsSchema }),
  sendQuote,
);
staffBookingRouter.post(
  "/quotes/:quoteId/expire",
  validate({ params: quoteIdParamsSchema }),
  expireQuote,
);
staffBookingRouter.post(
  "/quotes/:quoteId/schedule",
  validate({
    params: quoteIdParamsSchema,
    body: scheduleAcceptedQuoteBodySchema,
  }),
  scheduleAcceptedQuote,
);

/**
 * Mount at `/api/v1/employees`. This least-privilege calendar view requires active
 * StaffAccess but deliberately does not require `manage_bookings`.
 */
export const employeeSelfBookingRouter = Router();
employeeSelfBookingRouter.use(
  "/me/bookings",
  authenticate,
  authorizeRoles("employee"),
  requirePermissions(),
);
employeeSelfBookingRouter.get(
  "/me/bookings",
  validate({ query: employeeBookingListQuerySchema }),
  listMyEmployeeBookings,
);
employeeSelfBookingRouter.get(
  "/me/bookings/:bookingId",
  validate({ params: bookingIdParamsSchema }),
  getMyEmployeeBooking,
);

export default customerBookingRouter;
