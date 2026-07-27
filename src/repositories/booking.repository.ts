import type { ClientSession, QueryFilter, Types } from "mongoose";

import Booking, {
  type BookingStatus,
  type IBooking,
} from "../models/bookings/Booking.js";
import BookingItem from "../models/bookings/BookingItem.js";
import CalendarReservation from "../models/scheduling/CalendarReservation.js";

export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
  "requested",
  "pending_advance",
  "confirmed",
  "checked_in",
  "in_progress",
];

export interface BranchScope {
  allBranches: boolean;
  branchIds: string[];
}

export const applyBranchScope = (
  filter: QueryFilter<IBooking>,
  scope: BranchScope,
): QueryFilter<IBooking> => {
  if (!scope.allBranches) {
    filter.branchId = { $in: scope.branchIds };
  }
  return filter;
};

export const loadBookingAggregate = async (
  bookingId: string | Types.ObjectId,
  options: {
    session?: ClientSession;
    includePrivate?: boolean;
  } = {},
) => {
  const bookingQuery = Booking.findById(bookingId);
  if (options.includePrivate) {
    bookingQuery.select("+internalNote");
  }
  if (options.session) bookingQuery.session(options.session);
  const booking = await bookingQuery;
  if (!booking) return null;

  const itemsQuery = BookingItem.find({ bookingId: booking._id }).sort({ sequence: 1 });
  if (options.session) itemsQuery.session(options.session);
  const items = await itemsQuery;

  return { booking, items };
};

export const findConflictingReservations = async (
  reservations: Array<{
    resourceType: "employee" | "branch" | "chair" | "room" | "equipment";
    resourceId: Types.ObjectId;
    startAt: Date;
    endAt: Date;
    units?: number;
  }>,
  options: {
    session?: ClientSession;
    excludeBookingId?: string | Types.ObjectId;
    now?: Date;
  } = {},
) => {
  const now = options.now ?? new Date();
  if (reservations.length === 0) return [];

  const overlapFilters = reservations.map((reservation) => ({
    resourceType: reservation.resourceType,
    resourceId: reservation.resourceId,
    startAt: { $lt: reservation.endAt },
    endAt: { $gt: reservation.startAt },
  }));

  const query = CalendarReservation.find({
    ...(options.excludeBookingId
      ? { bookingId: { $ne: options.excludeBookingId } }
      : {}),
    $and: [
      {
        $or: [
          { status: "confirmed" },
          { status: "held", holdExpiresAt: { $gt: now } },
        ],
      },
      { $or: overlapFilters },
    ],
  }).select("resourceType resourceId startAt endAt status sourceType sourceId bookingId");
  if (options.session) query.session(options.session);
  return query.lean();
};

export const releaseBookingReservations = async (
  bookingId: string | Types.ObjectId,
  session: ClientSession,
): Promise<void> => {
  const reservations = await CalendarReservation.find({
    bookingId,
    status: { $ne: "released" },
  }).session(session);

  for (const reservation of reservations) {
    reservation.status = "released";
    reservation.holdExpiresAt = undefined;
    await reservation.save({ session });
  }
};

export const confirmBookingReservations = async (
  bookingId: string | Types.ObjectId,
  session: ClientSession,
): Promise<void> => {
  const reservations = await CalendarReservation.find({
    bookingId,
    status: "held",
  }).session(session);

  for (const reservation of reservations) {
    reservation.status = "confirmed";
    reservation.holdExpiresAt = undefined;
    await reservation.save({ session });
  }
};

export const setBookingItemsStatus = async (
  bookingId: string | Types.ObjectId,
  status: BookingStatus,
  session: ClientSession,
): Promise<void> => {
  await BookingItem.updateMany({ bookingId }, { $set: { status } }, { session });
};

export const bookingRepository = {
  loadAggregate: loadBookingAggregate,
  findConflictingReservations,
  releaseReservations: releaseBookingReservations,
  confirmReservations: confirmBookingReservations,
  setItemsStatus: setBookingItemsStatus,
};

