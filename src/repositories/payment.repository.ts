import type {
  ClientSession,
  QueryFilter,
  Types,
} from "mongoose";

import Booking from "../models/bookings/Booking.js";
import Customer from "../models/customers/Customer.js";
import BookingPayment, {
  type IBookingPayment,
} from "../models/payments/BookingPayment.js";
import PaymentWebhookEvent from "../models/payments/PaymentWebhookEvent.js";

export const PAYMENT_SAFE_SELECT =
  "branchId bookingId customerId purpose provider amountMinor currency status paymentMethodType relatedPaymentId checkoutExpiresAt processedAt createdAt updatedAt";

export const paymentRepository = {
  findCustomerByUserId: (userId: Types.ObjectId) =>
    Customer.findOne({ userId }).select("_id status").lean(),

  findBooking: (bookingId: Types.ObjectId, session?: ClientSession) =>
    Booking.findById(bookingId).session(session ?? null),

  findById: (
    paymentId: Types.ObjectId,
    includeVerificationFields = false,
    session?: ClientSession,
  ) =>
    BookingPayment.findById(paymentId)
      .select(
        includeVerificationFields
          ? `${PAYMENT_SAFE_SELECT} +merchantAccountId +providerTransactionId +idempotencyKey`
          : PAYMENT_SAFE_SELECT,
      )
      .session(session ?? null),

  findByIdempotencyKey: (
    provider: string,
    idempotencyKey: string,
    session?: ClientSession,
  ) =>
    BookingPayment.findOne({ provider, idempotencyKey })
      .select(
        `${PAYMENT_SAFE_SELECT} +merchantAccountId +providerTransactionId +providerCheckoutId +encryptedCheckoutData +checkoutExpiresAt +idempotencyKey`,
      )
      .session(session ?? null),

  list: async (
    filter: QueryFilter<IBookingPayment>,
    skip: number,
    limit: number,
  ) => {
    const [items, total] = await Promise.all([
      BookingPayment.find(filter)
        .select(PAYMENT_SAFE_SELECT)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      BookingPayment.countDocuments(filter),
    ]);
    return { items, total };
  },

  sumSuccessfulRefunds: async (
    paymentId: Types.ObjectId,
    session: ClientSession,
  ): Promise<number> => {
    const result = await BookingPayment.aggregate<{ total: number }>([
      {
        $match: {
          relatedPaymentId: paymentId,
          purpose: "advance_refund",
          status: "succeeded",
        },
      },
      { $group: { _id: null, total: { $sum: "$amountMinor" } } },
    ]).session(session);
    return result[0]?.total ?? 0;
  },

  createPayment: async (
    input: Omit<IBookingPayment, "createdAt" | "updatedAt">,
    session: ClientSession,
  ) => {
    const [payment] = await BookingPayment.create([input], { session });
    return payment;
  },

  findWebhook: (
    provider: string,
    merchantAccountId: string,
    providerEventId: string,
  ) =>
    PaymentWebhookEvent.findOne({
      provider,
      merchantAccountId,
      providerEventId,
    }).select(
      "+encryptedPayload +payloadHash +lastError",
    ),
};
