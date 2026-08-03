import type { IncomingHttpHeaders } from "node:http";

import type mongoose from "mongoose";
import { Types, type QueryFilter } from "mongoose";

import BookingPayment, {
  type IBookingPayment,
} from "../models/payments/BookingPayment.js";
import PaymentWebhookEvent, {
  type IPaymentWebhookEvent,
} from "../models/payments/PaymentWebhookEvent.js";
import OutboxEvent from "../models/events/OutboxEvent.js";
import CalendarReservation from "../models/scheduling/CalendarReservation.js";
import {
  getPaymentProvider,
  type VerifiedPaymentTransaction,
  type WebhookHeaders,
  listConfiguredPaymentProviders,
} from "../ports/payment-provider.js";
import {
  PAYMENT_SAFE_SELECT,
  paymentRepository,
} from "../repositories/payment.repository.js";
import type {
  CustomerPaymentListQuery,
  CreateAdvanceCheckoutBody,
  PaymentListQuery,
  RecordAdvanceBody,
  RecordRefundBody,
  WebhookEventListQuery,
} from "../validation/payment.schemas.js";
import { ApiError } from "../utils/ApiError.js";
import {
  assertDataEncryptionConfigured,
  decryptSensitiveText,
  encryptSensitiveText,
  sha256,
} from "../utils/fieldEncryption.js";
import { isSafeExternalHttpsUrl } from "../models/core/shared.js";
import { buildPaginationMeta } from "../utils/pagination.js";
import { withTransaction } from "../utils/database.js";
import {
  isWorkerLeaseLostError,
  runWithLeaseHeartbeat,
} from "../utils/workerLease.js";
import {
  recordAudit,
  type AuditActorContext,
} from "./audit.service.js";
import {
  assertOperationalBranchAccess,
  type StaffBranchScope,
} from "./operational-access.js";
import { confirmBookingAfterRequiredAdvance } from "./booking.service.js";
import { redisService } from "./redis.service.js";

interface NormalizedPaymentInput {
  provider: string;
  merchantAccountId?: string;
  providerTransactionId?: string;
  amountMinor: number;
  currency: string;
  paymentMethodType?: IBookingPayment["paymentMethodType"];
  processedAt: Date;
}

interface StoredWebhookEnvelope {
  body: string;
  headers: WebhookHeaders;
}

interface SafeAdvanceCheckout {
  provider: string;
  checkoutId: string;
  checkoutUrl?: string;
  clientToken?: string;
  expiresAt: Date;
  bookingId: Types.ObjectId;
  amountMinor: number;
  currency: string;
}

const toSafePayment = (
  payment: mongoose.HydratedDocument<IBookingPayment>,
) => ({
  _id: payment._id,
  branchId: payment.branchId,
  bookingId: payment.bookingId,
  customerId: payment.customerId,
  purpose: payment.purpose,
  provider: payment.provider,
  amountMinor: payment.amountMinor,
  currency: payment.currency,
  status: payment.status,
  paymentMethodType: payment.paymentMethodType,
  relatedPaymentId: payment.relatedPaymentId,
  checkoutExpiresAt: payment.checkoutExpiresAt,
  processedAt: payment.processedAt,
  createdAt: payment.createdAt,
  updatedAt: payment.updatedAt,
});

const toObjectId = (value: string): Types.ObjectId =>
  new Types.ObjectId(value);

const isDuplicateKey = (error: unknown): boolean =>
  Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === 11000,
  );

const ensureReasonableProcessedAt = (processedAt: Date): void => {
  if (processedAt.getTime() > Date.now() + 5 * 60_000) {
    throw ApiError.badRequest(
      "processedAt cannot be in the future",
      undefined,
      "INVALID_PAYMENT_TIME",
    );
  }
};

const verifyOrAttestPayment = async (
  input: RecordAdvanceBody | RecordRefundBody,
  bookingId: string,
  purpose: "advance" | "advance_refund",
): Promise<NormalizedPaymentInput> => {
  if (input.provider === "manual") {
    const processedAt = input.processedAt ?? new Date();
    ensureReasonableProcessedAt(processedAt);
    return {
      provider: "manual",
      merchantAccountId: input.merchantAccountId,
      providerTransactionId: input.providerTransactionId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      paymentMethodType: input.paymentMethodType ?? "external",
      processedAt,
    };
  }

  if (!input.providerTransactionId) {
    throw ApiError.badRequest(
      "An external provider transaction ID is required",
      undefined,
      "PROVIDER_TRANSACTION_REQUIRED",
    );
  }
  const verified: VerifiedPaymentTransaction =
    await getPaymentProvider(input.provider).verifyTransaction({
      providerTransactionId: input.providerTransactionId,
      merchantAccountId: input.merchantAccountId,
      expectedBookingId: bookingId,
      expectedAmountMinor: input.amountMinor,
      expectedCurrency: input.currency,
      expectedPurpose: purpose,
    });
  if (
    verified.status !== "succeeded" ||
    verified.purpose !== purpose ||
    verified.amountMinor !== input.amountMinor ||
    verified.currency.toUpperCase() !== input.currency
  ) {
    throw ApiError.conflict(
      "Provider verification did not match the requested payment",
      undefined,
      "PAYMENT_VERIFICATION_MISMATCH",
    );
  }
  ensureReasonableProcessedAt(verified.processedAt);
  return {
    provider: input.provider,
    merchantAccountId: verified.merchantAccountId,
    providerTransactionId: verified.providerTransactionId,
    amountMinor: verified.amountMinor,
    currency: verified.currency.toUpperCase(),
    paymentMethodType: verified.paymentMethodType ?? "external",
    processedAt: verified.processedAt,
  };
};

const assertIdempotentMatch = (
  existing: IBookingPayment,
  expected: {
    bookingId: Types.ObjectId;
    purpose: IBookingPayment["purpose"];
    amountMinor: number;
    currency: string;
    relatedPaymentId?: Types.ObjectId;
  },
): void => {
  if (
    !existing.bookingId.equals(expected.bookingId) ||
    existing.purpose !== expected.purpose ||
    existing.amountMinor !== expected.amountMinor ||
    existing.currency !== expected.currency ||
    (existing.relatedPaymentId?.toString() ?? undefined) !==
      (expected.relatedPaymentId?.toString() ?? undefined)
  ) {
    throw ApiError.conflict(
      "The idempotency key was already used for a different payment",
      undefined,
      "IDEMPOTENCY_KEY_REUSED",
    );
  }
};

const createPaymentOutbox = async (
  payment: { _id: Types.ObjectId; bookingId: Types.ObjectId; purpose: string; status: string },
  session: mongoose.ClientSession,
): Promise<void> => {
  await OutboxEvent.create(
    [
      {
        aggregateType: "booking_payment",
        aggregateId: payment._id,
        eventType: `booking_payment.${payment.purpose}.${payment.status}`,
        payload: {
          paymentId: payment._id.toString(),
          bookingId: payment.bookingId.toString(),
        },
      },
    ],
    { session },
  );
};

const decodeCheckout = (
  payment: mongoose.HydratedDocument<IBookingPayment>,
): SafeAdvanceCheckout => {
  if (
    !payment.providerCheckoutId ||
    !payment.encryptedCheckoutData ||
    !payment.checkoutExpiresAt
  ) {
    throw new Error("Persisted checkout data is incomplete");
  }
  const data = JSON.parse(
    decryptSensitiveText(
      payment.encryptedCheckoutData,
      `payment-checkout:${payment.provider}:${payment.bookingId.toString()}`,
    ),
  ) as { checkoutUrl?: string; clientToken?: string };
  return {
    provider: payment.provider,
    checkoutId: payment.providerCheckoutId,
    checkoutUrl: data.checkoutUrl,
    clientToken: data.clientToken,
    expiresAt: payment.checkoutExpiresAt,
    bookingId: payment.bookingId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
  };
};

const assertCheckoutResultIsSafe = (result: {
  providerCheckoutId: string;
  checkoutUrl?: string;
  clientToken?: string;
  expiresAt: Date;
}): void => {
  if (
    !result.providerCheckoutId ||
    result.providerCheckoutId.length > 255 ||
    !(result.expiresAt instanceof Date) ||
    result.expiresAt <= new Date()
  ) {
    throw new Error("Payment provider returned an invalid checkout result");
  }
  if (
    result.checkoutUrl &&
    (!isSafeExternalHttpsUrl(result.checkoutUrl) ||
      result.checkoutUrl.length > 2048)
  ) {
    throw new Error("Payment provider returned an unsafe checkout URL");
  }
  if (result.clientToken && result.clientToken.length > 8192) {
    throw new Error("Payment provider returned an oversized client token");
  }
  if (!result.checkoutUrl && !result.clientToken) {
    throw new Error("Payment provider returned no client checkout data");
  }
};

const branchFilterForScope = (
  queryBranchId: string | undefined,
  scope: StaffBranchScope,
): QueryFilter<IBookingPayment> => {
  if (queryBranchId) {
    assertOperationalBranchAccess(scope, queryBranchId);
    return { branchId: toObjectId(queryBranchId) };
  }
  return scope.allBranches
    ? {}
    : { branchId: { $in: scope.branchIds } };
};

export const paymentService = {
  async createAdvanceCheckout(
    userId: string,
    input: CreateAdvanceCheckoutBody,
    idempotencyKey: string,
    context: AuditActorContext,
  ): Promise<SafeAdvanceCheckout> {
    const customer = await paymentRepository.findCustomerByUserId(
      toObjectId(userId),
    );
    if (!customer || customer.status !== "active") {
      throw ApiError.notFound(
        "Customer profile was not found",
        "CUSTOMER_PROFILE_NOT_FOUND",
      );
    }
    const idempotent = await paymentRepository.findByIdempotencyKey(
      input.provider,
      idempotencyKey,
    );
    if (idempotent) {
      if (!idempotent.providerCheckoutId || !idempotent.encryptedCheckoutData) {
        throw ApiError.conflict(
          "The idempotency key was already used for another payment operation",
          undefined,
          "IDEMPOTENCY_KEY_REUSED",
        );
      }
      assertIdempotentMatch(idempotent, {
        bookingId: toObjectId(input.bookingId),
        purpose: "advance",
        amountMinor: input.amountMinor ?? idempotent.amountMinor,
        currency: idempotent.currency,
      });
      if (!idempotent.customerId.equals(customer._id)) {
        throw ApiError.conflict(
          "The idempotency key belongs to another customer",
          undefined,
          "IDEMPOTENCY_KEY_REUSED",
        );
      }
      return decodeCheckout(idempotent);
    }

    const booking = await paymentRepository.findBooking(
      toObjectId(input.bookingId),
    );
    if (!booking || !booking.customerId.equals(customer._id)) {
      throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
    }
    const now = new Date();
    if (booking.startAt <= now) {
      throw ApiError.conflict(
        "An advance cannot be started after the booking begins",
        undefined,
        "BOOKING_ALREADY_STARTED",
      );
    }
    const requirement = booking.pricingSnapshot.advanceRequirement;
    if (
      (requirement === "required" && booking.status !== "pending_advance") ||
      (requirement === "optional" && booking.status !== "confirmed") ||
      requirement === "none"
    ) {
      throw ApiError.conflict(
        "This booking is not eligible for an advance checkout",
        undefined,
        "ADVANCE_CHECKOUT_NOT_ALLOWED",
      );
    }
    const remaining =
      booking.pricingSnapshot.advanceDueMinor -
      booking.pricingSnapshot.advancePaidMinor;
    const amountMinor = input.amountMinor ?? remaining;
    if (
      remaining <= 0 ||
      amountMinor > remaining ||
      (requirement === "required" && amountMinor !== remaining)
    ) {
      throw ApiError.conflict(
        "Checkout amount does not match the remaining advance",
        { remainingAmountMinor: Math.max(0, remaining) },
        "INVALID_ADVANCE_AMOUNT",
      );
    }
    if (requirement === "required") {
      if (!booking.expiresAt || booking.expiresAt <= now) {
        throw ApiError.conflict(
          "The booking hold has expired",
          undefined,
          "BOOKING_HOLD_EXPIRED",
        );
      }
      const heldCount = await CalendarReservation.countDocuments({
        bookingId: booking._id,
        status: "held",
        holdExpiresAt: { $gt: now },
      });
      if (heldCount !== booking.reservationCountSnapshot) {
        throw ApiError.conflict(
          "The complete booking hold is no longer available",
          undefined,
          "BOOKING_HOLD_INCOMPLETE",
        );
      }
    }
    const lockKey = `advance-checkout:${booking._id.toString()}`;
    const lockTtlMs = 30_000;
    let lockToken: string | null;
    try {
      lockToken = await redisService.acquireLock(lockKey, lockTtlMs);
    } catch (error) {
      throw new ApiError(503, "Advance checkout locking is unavailable", {
        code: "CHECKOUT_LOCK_UNAVAILABLE",
        cause: error,
        expose: true,
      });
    }
    if (!lockToken) {
      throw ApiError.conflict(
        "Another advance checkout request is in progress",
        undefined,
        "ADVANCE_CHECKOUT_BUSY",
      );
    }

    try {
      return await runWithLeaseHeartbeat(
        async () => {
          const guardedNow = new Date();
          const expiredCheckouts = await BookingPayment.updateMany(
            {
              bookingId: booking._id,
              purpose: "advance",
              status: "pending",
              checkoutExpiresAt: { $lte: guardedNow },
            },
            { $set: { status: "cancelled" } },
          );
          if (expiredCheckouts.modifiedCount > 0) {
            await recordAudit({
              context,
              action: "booking_payment.advance_checkout.expired",
              entityType: "BookingPayment",
              changes: {
                bookingId: booking._id.toString(),
                count: expiredCheckouts.modifiedCount,
              },
            });
          }
          const lockedBooking = await paymentRepository.findBooking(booking._id);
          if (
            !lockedBooking ||
            !lockedBooking.customerId.equals(customer._id) ||
            lockedBooking.startAt <= guardedNow
          ) {
            throw ApiError.conflict(
              "Booking is no longer eligible for an advance checkout",
              undefined,
              "ADVANCE_STATE_CHANGED",
            );
          }
          const lockedRequirement =
            lockedBooking.pricingSnapshot.advanceRequirement;
          const lockedRemaining =
            lockedBooking.pricingSnapshot.advanceDueMinor -
            lockedBooking.pricingSnapshot.advancePaidMinor;
          if (
            (lockedRequirement === "required" &&
              lockedBooking.status !== "pending_advance") ||
            (lockedRequirement === "optional" &&
              lockedBooking.status !== "confirmed") ||
            lockedRequirement === "none" ||
            amountMinor > lockedRemaining ||
            (lockedRequirement === "required" &&
              amountMinor !== lockedRemaining)
          ) {
            throw ApiError.conflict(
              "Booking advance state changed before checkout creation",
              { remainingAmountMinor: Math.max(0, lockedRemaining) },
              "ADVANCE_STATE_CHANGED",
            );
          }
          if (lockedRequirement === "required") {
            if (
              !lockedBooking.expiresAt ||
              lockedBooking.expiresAt <= guardedNow
            ) {
              throw ApiError.conflict(
                "The booking hold has expired",
                undefined,
                "BOOKING_HOLD_EXPIRED",
              );
            }
            const lockedHeldCount =
              await CalendarReservation.countDocuments({
                bookingId: lockedBooking._id,
                status: "held",
                holdExpiresAt: { $gt: guardedNow },
              });
            if (
              lockedHeldCount !== lockedBooking.reservationCountSnapshot
            ) {
              throw ApiError.conflict(
                "The complete booking hold is no longer available",
                undefined,
                "BOOKING_HOLD_INCOMPLETE",
              );
            }
          }
          const activeCheckout = await BookingPayment.exists({
            bookingId: lockedBooking._id,
            purpose: "advance",
            status: "pending",
            checkoutExpiresAt: { $gt: guardedNow },
          });
          if (activeCheckout) {
            throw ApiError.conflict(
              "An active advance checkout already exists",
              undefined,
              "ADVANCE_CHECKOUT_ALREADY_ACTIVE",
            );
          }

          assertDataEncryptionConfigured();
          const adapter = getPaymentProvider(input.provider);
          const checkout = await adapter.createAdvanceCheckout({
            idempotencyKey,
            bookingId: lockedBooking._id.toString(),
            bookingReference: lockedBooking.reference,
            customer: {
              id: customer._id.toString(),
              name: lockedBooking.customerSnapshot.name,
              email: lockedBooking.customerSnapshot.email,
              phone: lockedBooking.customerSnapshot.phone,
            },
            amountMinor,
            currency: lockedBooking.pricingSnapshot.currency,
            holdExpiresAt:
              lockedRequirement === "required"
                ? lockedBooking.expiresAt
                : undefined,
          });
          assertCheckoutResultIsSafe(checkout);
          if (
            lockedRequirement === "required" &&
            lockedBooking.expiresAt &&
            checkout.expiresAt > lockedBooking.expiresAt
          ) {
            throw new Error(
              "Payment checkout must expire before the booking hold",
            );
          }
          const encryptedCheckoutData = encryptSensitiveText(
            JSON.stringify({
              checkoutUrl: checkout.checkoutUrl,
              clientToken: checkout.clientToken,
            }),
            `payment-checkout:${input.provider}:${lockedBooking._id.toString()}`,
          );

          const payment = await withTransaction(async (session) => {
            const raced = await paymentRepository.findByIdempotencyKey(
              input.provider,
              idempotencyKey,
              session,
            );
            if (raced) {
              if (
                !raced.providerCheckoutId ||
                !raced.encryptedCheckoutData
              ) {
                throw ApiError.conflict(
                  "The idempotency key was already used for another payment operation",
                  undefined,
                  "IDEMPOTENCY_KEY_REUSED",
                );
              }
              assertIdempotentMatch(raced, {
                bookingId: lockedBooking._id,
                purpose: "advance",
                amountMinor,
                currency: lockedBooking.pricingSnapshot.currency,
              });
              return raced;
            }
            const current = await paymentRepository.findBooking(
              lockedBooking._id,
              session,
            );
            if (
              !current ||
              !current.customerId.equals(customer._id) ||
              current.pricingSnapshot.advanceDueMinor -
                current.pricingSnapshot.advancePaidMinor <
                amountMinor
            ) {
              throw ApiError.conflict(
                "Booking advance state changed while checkout was created",
                undefined,
                "ADVANCE_STATE_CHANGED",
              );
            }
            if (
              current.pricingSnapshot.advanceRequirement === "required" &&
              (!current.expiresAt || current.expiresAt <= new Date())
            ) {
              throw ApiError.conflict(
                "The booking hold expired while checkout was created",
                undefined,
                "BOOKING_HOLD_EXPIRED",
              );
            }
            if (
              current.pricingSnapshot.advanceRequirement === "required"
            ) {
              const currentHeldCount =
                await CalendarReservation.countDocuments({
                  bookingId: current._id,
                  status: "held",
                  holdExpiresAt: { $gt: new Date() },
                }).session(session);
              if (
                currentHeldCount !== current.reservationCountSnapshot
              ) {
                throw ApiError.conflict(
                  "The complete booking hold is no longer available",
                  undefined,
                  "BOOKING_HOLD_INCOMPLETE",
                );
              }
            }
            const anotherActive = await BookingPayment.exists({
              bookingId: current._id,
              purpose: "advance",
              status: "pending",
              checkoutExpiresAt: { $gt: new Date() },
            }).session(session);
            if (anotherActive) {
              throw ApiError.conflict(
                "An active advance checkout already exists",
                undefined,
                "ADVANCE_CHECKOUT_ALREADY_ACTIVE",
              );
            }
            const created = await paymentRepository.createPayment(
              {
                branchId: current.branchId,
                bookingId: current._id,
                customerId: current.customerId,
                purpose: "advance",
                provider: input.provider,
                providerCheckoutId: checkout.providerCheckoutId,
                encryptedCheckoutData,
                checkoutExpiresAt: checkout.expiresAt,
                idempotencyKey,
                amountMinor,
                currency: current.pricingSnapshot.currency,
                status: "pending",
                paymentMethodType: "external",
              },
              session,
            );
            await recordAudit(
              {
                context,
                action: "booking_payment.advance_checkout.created",
                entityType: "BookingPayment",
                entityId: created._id,
                changes: {
                  bookingId: current._id.toString(),
                  provider: input.provider,
                  amountMinor,
                  currency: current.pricingSnapshot.currency,
                },
              },
              session,
            );
            return created;
          });
          return decodeCheckout(payment);
        },
        () => redisService.extendLock(lockKey, lockToken, lockTtlMs),
        lockTtlMs,
      );
    } catch (error) {
      if (isWorkerLeaseLostError(error)) {
        throw ApiError.conflict(
          "Advance checkout lock was lost; retry with the same idempotency key",
          undefined,
          "ADVANCE_CHECKOUT_LOCK_LOST",
        );
      }
      throw error;
    } finally {
      await redisService.releaseLock(lockKey, lockToken).catch(() => false);
    }
  },

  async listForCustomer(userId: string, query: CustomerPaymentListQuery) {
    const customer = await paymentRepository.findCustomerByUserId(
      toObjectId(userId),
    );
    if (!customer) {
      throw ApiError.notFound(
        "Customer profile was not found",
        "CUSTOMER_PROFILE_NOT_FOUND",
      );
    }
    const filter: QueryFilter<IBookingPayment> = {
      customerId: customer._id,
      purpose: { $in: ["advance", "advance_refund"] },
    };
    if (query.bookingId) filter.bookingId = toObjectId(query.bookingId);
    if (query.status) filter.status = query.status;
    const result = await paymentRepository.list(
      filter,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, query),
    };
  },

  async listForStaff(query: PaymentListQuery, scope: StaffBranchScope) {
    const filter: QueryFilter<IBookingPayment> = {
      ...branchFilterForScope(query.branchId, scope),
    };
    if (query.bookingId) filter.bookingId = toObjectId(query.bookingId);
    if (query.customerId) filter.customerId = toObjectId(query.customerId);
    if (query.purpose) filter.purpose = query.purpose;
    if (query.status) filter.status = query.status;
    if (query.provider) filter.provider = query.provider;
    if (query.from || query.to) {
      filter.createdAt = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lt: query.to } : {}),
      };
    }
    const result = await paymentRepository.list(
      filter,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return {
      items: result.items,
      pagination: buildPaginationMeta(result.total, query),
    };
  },

  async getForCustomer(userId: string, paymentId: string) {
    const customer = await paymentRepository.findCustomerByUserId(
      toObjectId(userId),
    );
    if (!customer) {
      throw ApiError.notFound("Payment was not found", "PAYMENT_NOT_FOUND");
    }
    const payment = await BookingPayment.findOne({
      _id: paymentId,
      customerId: customer._id,
      purpose: { $in: ["advance", "advance_refund"] },
    })
      .select(PAYMENT_SAFE_SELECT)
      .lean();
    if (!payment) {
      throw ApiError.notFound("Payment was not found", "PAYMENT_NOT_FOUND");
    }
    return payment;
  },

  async getForStaff(paymentId: string, scope: StaffBranchScope) {
    const payment = await paymentRepository.findById(toObjectId(paymentId));
    if (!payment) {
      throw ApiError.notFound("Payment was not found", "PAYMENT_NOT_FOUND");
    }
    assertOperationalBranchAccess(scope, payment.branchId);
    return payment;
  },

  async recordAdvance(
    input: RecordAdvanceBody,
    idempotencyKey: string,
    scope: StaffBranchScope,
    context: AuditActorContext,
  ) {
    const verified = await verifyOrAttestPayment(
      input,
      input.bookingId,
      "advance",
    );
    const bookingId = toObjectId(input.bookingId);

    const payment = await withTransaction(async (session) => {
      const existing = await paymentRepository.findByIdempotencyKey(
        verified.provider,
        idempotencyKey,
        session,
      );
      if (existing) {
        assertIdempotentMatch(existing, {
          bookingId,
          purpose: "advance",
          amountMinor: verified.amountMinor,
          currency: verified.currency,
        });
        return existing;
      }

      const booking = await paymentRepository.findBooking(bookingId, session);
      if (!booking) {
        throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
      }
      assertOperationalBranchAccess(scope, booking.branchId);
      if (["completed", "cancelled", "no_show"].includes(booking.status)) {
        throw ApiError.conflict(
          "An advance cannot be added to a terminal booking",
          undefined,
          "BOOKING_TERMINAL",
        );
      }
      if (booking.pricingSnapshot.currency !== verified.currency) {
        throw ApiError.conflict(
          "Payment currency does not match the booking",
          undefined,
          "PAYMENT_CURRENCY_MISMATCH",
        );
      }
      const remaining =
        booking.pricingSnapshot.advanceDueMinor -
        booking.pricingSnapshot.advancePaidMinor;
      if (remaining <= 0 || verified.amountMinor > remaining) {
        throw ApiError.conflict(
          "Payment exceeds the remaining advance",
          { remainingAmountMinor: Math.max(0, remaining) },
          "ADVANCE_AMOUNT_EXCEEDED",
        );
      }

      const payment = await paymentRepository.createPayment(
        {
          branchId: booking.branchId,
          bookingId: booking._id,
          customerId: booking.customerId,
          purpose: "advance",
          provider: verified.provider,
          merchantAccountId: verified.merchantAccountId,
          providerTransactionId: verified.providerTransactionId,
          idempotencyKey,
          amountMinor: verified.amountMinor,
          currency: verified.currency,
          status: "succeeded",
          paymentMethodType: verified.paymentMethodType,
          processedAt: verified.processedAt,
        },
        session,
      );
      booking.pricingSnapshot.advancePaidMinor += verified.amountMinor;
      booking.markModified("pricingSnapshot");
      booking.updatedByUserId = context.actorUserId
        ? toObjectId(context.actorUserId.toString())
        : undefined;
      await booking.save({ session });

      if (
        booking.status === "pending_advance" &&
        booking.pricingSnapshot.advancePaidMinor >=
          booking.pricingSnapshot.advanceDueMinor
      ) {
        await confirmBookingAfterRequiredAdvance(
          booking._id,
          session,
          payment._id,
        );
      }
      await createPaymentOutbox(payment, session);
      await recordAudit(
        {
          context,
          action: "booking_payment.advance.recorded",
          entityType: "BookingPayment",
          entityId: payment._id,
          changes: {
            bookingId: booking._id.toString(),
            provider: verified.provider,
            amountMinor: verified.amountMinor,
            currency: verified.currency,
          },
        },
        session,
      );
      return payment;
    });
    return toSafePayment(payment);
  },

  async recordRefund(
    originalPaymentId: string,
    input: RecordRefundBody,
    idempotencyKey: string,
    scope: StaffBranchScope,
    context: AuditActorContext,
  ) {
    const originalId = toObjectId(originalPaymentId);
    const original = await paymentRepository.findById(originalId, true);
    if (
      !original ||
      original.purpose !== "advance" ||
      !["succeeded", "refunded"].includes(original.status)
    ) {
      throw ApiError.notFound(
        "A refundable advance payment was not found",
        "REFUNDABLE_PAYMENT_NOT_FOUND",
      );
    }
    assertOperationalBranchAccess(scope, original.branchId);
    const verified = await verifyOrAttestPayment(
      input,
      original.bookingId.toString(),
      "advance_refund",
    );

    const payment = await withTransaction(async (session) => {
      const idempotent = await paymentRepository.findByIdempotencyKey(
        verified.provider,
        idempotencyKey,
        session,
      );
      if (idempotent) {
        assertIdempotentMatch(idempotent, {
          bookingId: original.bookingId,
          purpose: "advance_refund",
          amountMinor: verified.amountMinor,
          currency: verified.currency,
          relatedPaymentId: originalId,
        });
        return idempotent;
      }
      const current = await paymentRepository.findById(
        originalId,
        true,
        session,
      );
      const booking = await paymentRepository.findBooking(
        original.bookingId,
        session,
      );
      if (!current || !booking) {
        throw ApiError.notFound("Payment or booking was not found");
      }
      assertOperationalBranchAccess(scope, booking.branchId);
      if (verified.currency !== current.currency) {
        throw ApiError.conflict(
          "Refund currency must match the original payment",
          undefined,
          "REFUND_CURRENCY_MISMATCH",
        );
      }
      const refunded = await paymentRepository.sumSuccessfulRefunds(
        current._id,
        session,
      );
      const remaining = current.amountMinor - refunded;
      if (verified.amountMinor > remaining) {
        throw ApiError.conflict(
          "Refund exceeds the remaining refundable amount",
          { remainingAmountMinor: remaining },
          "REFUND_AMOUNT_EXCEEDED",
        );
      }
      if (booking.pricingSnapshot.advancePaidMinor < verified.amountMinor) {
        throw ApiError.conflict(
          "Booking advance balance is lower than the refund",
          undefined,
          "ADVANCE_BALANCE_CONFLICT",
        );
      }
      const refund = await paymentRepository.createPayment(
        {
          branchId: current.branchId,
          bookingId: current.bookingId,
          customerId: current.customerId,
          purpose: "advance_refund",
          provider: verified.provider,
          merchantAccountId: verified.merchantAccountId,
          providerTransactionId: verified.providerTransactionId,
          idempotencyKey,
          amountMinor: verified.amountMinor,
          currency: verified.currency,
          status: "succeeded",
          paymentMethodType: verified.paymentMethodType,
          relatedPaymentId: current._id,
          processedAt: verified.processedAt,
        },
        session,
      );
      if (refunded + verified.amountMinor === current.amountMinor) {
        current.status = "refunded";
        await current.save({ session });
      }
      booking.pricingSnapshot.advancePaidMinor -= verified.amountMinor;
      booking.markModified("pricingSnapshot");
      booking.updatedByUserId = context.actorUserId
        ? toObjectId(context.actorUserId.toString())
        : undefined;
      await booking.save({ session });
      await createPaymentOutbox(refund, session);
      await recordAudit(
        {
          context,
          action: "booking_payment.advance.refunded",
          entityType: "BookingPayment",
          entityId: refund._id,
          changes: {
            originalPaymentId: current._id.toString(),
            amountMinor: verified.amountMinor,
            currency: verified.currency,
          },
        },
        session,
      );
      return refund;
    });
    return toSafePayment(payment);
  },
};

export interface VerifiedAdvanceSettlementInput {
  provider: string;
  providerCheckoutId: string;
  providerTransactionId: string;
  amountMinor: number;
  currency: string;
  processedAt: Date;
  merchantAccountId?: string;
  paymentMethodType?: IBookingPayment["paymentMethodType"];
}

export const applyVerifiedAdvanceSettlement = async (
  input: VerifiedAdvanceSettlementInput,
) => {
  ensureReasonableProcessedAt(input.processedAt);
  return withTransaction(async (session) => {
    const payment = await BookingPayment.findOne({
      provider: input.provider,
      providerCheckoutId: input.providerCheckoutId,
    })
      .select(
        `${PAYMENT_SAFE_SELECT} +providerCheckoutId +providerTransactionId +merchantAccountId +checkoutExpiresAt`,
      )
      .session(session);
    if (!payment) {
      throw ApiError.notFound(
        "Advance checkout was not found",
        "ADVANCE_CHECKOUT_NOT_FOUND",
      );
    }
    if (payment.status === "succeeded") {
      if (
        payment.providerTransactionId !== input.providerTransactionId ||
        payment.amountMinor !== input.amountMinor ||
        payment.currency !== input.currency.toUpperCase() ||
        (payment.merchantAccountId &&
          input.merchantAccountId &&
          payment.merchantAccountId !== input.merchantAccountId)
      ) {
        throw ApiError.conflict(
          "Checkout replay does not match the original settlement",
          undefined,
          "PAYMENT_SETTLEMENT_CONFLICT",
        );
      }
      return toSafePayment(payment);
    }
    if (
      payment.status !== "pending" ||
      payment.amountMinor !== input.amountMinor ||
      payment.currency !== input.currency.toUpperCase()
    ) {
      throw ApiError.conflict(
        "Verified settlement does not match the pending checkout",
        undefined,
        "PAYMENT_VERIFICATION_MISMATCH",
      );
    }
    const booking = await paymentRepository.findBooking(
      payment.bookingId,
      session,
    );
    if (!booking) {
      throw ApiError.notFound("Booking was not found", "BOOKING_NOT_FOUND");
    }
    if (
      !booking.customerId.equals(payment.customerId) ||
      !booking.branchId.equals(payment.branchId)
    ) {
      throw new Error("Payment ownership does not match its booking");
    }
    if (
      (booking.pricingSnapshot.advanceRequirement === "required" &&
        booking.status !== "pending_advance") ||
      (booking.pricingSnapshot.advanceRequirement === "optional" &&
        booking.status !== "confirmed") ||
      booking.pricingSnapshot.advanceRequirement === "none" ||
      (payment.checkoutExpiresAt &&
        input.processedAt > payment.checkoutExpiresAt)
    ) {
      throw ApiError.conflict(
        "The checkout is no longer eligible for settlement",
        undefined,
        "ADVANCE_CHECKOUT_EXPIRED",
      );
    }
    const remaining =
      booking.pricingSnapshot.advanceDueMinor -
      booking.pricingSnapshot.advancePaidMinor;
    if (
      remaining < input.amountMinor ||
      (booking.pricingSnapshot.advanceRequirement === "required" &&
        remaining !== input.amountMinor)
    ) {
      throw ApiError.conflict(
        "Verified settlement does not match the remaining advance",
        undefined,
        "ADVANCE_STATE_CHANGED",
      );
    }
    if (booking.pricingSnapshot.advanceRequirement === "required") {
      if (!booking.expiresAt || booking.expiresAt <= input.processedAt) {
        throw ApiError.conflict(
          "The required-advance booking hold expired before settlement",
          undefined,
          "BOOKING_HOLD_EXPIRED",
        );
      }
      const heldCount = await CalendarReservation.countDocuments({
        bookingId: booking._id,
        status: "held",
        holdExpiresAt: { $gt: input.processedAt },
      }).session(session);
      if (heldCount !== booking.reservationCountSnapshot) {
        throw ApiError.conflict(
          "The complete booking hold is no longer available",
          undefined,
          "BOOKING_HOLD_INCOMPLETE",
        );
      }
    }
    payment.status = "succeeded";
    payment.providerTransactionId = input.providerTransactionId;
    payment.merchantAccountId = input.merchantAccountId;
    payment.paymentMethodType = input.paymentMethodType ?? "external";
    payment.processedAt = input.processedAt;
    await payment.save({ session });
    booking.pricingSnapshot.advancePaidMinor += input.amountMinor;
    booking.markModified("pricingSnapshot");
    await booking.save({ session });
    if (
      booking.status === "pending_advance" &&
      booking.pricingSnapshot.advancePaidMinor >=
        booking.pricingSnapshot.advanceDueMinor
    ) {
      await confirmBookingAfterRequiredAdvance(
        booking._id,
        session,
        payment._id,
      );
    }
    await createPaymentOutbox(payment, session);
    await recordAudit(
      {
        context: { actorType: "integration" },
        action: "booking_payment.advance_checkout.settled",
        entityType: "BookingPayment",
        entityId: payment._id,
        changes: {
          bookingId: booking._id.toString(),
          provider: input.provider,
          amountMinor: input.amountMinor,
          currency: input.currency.toUpperCase(),
        },
      },
      session,
    );
    return toSafePayment(payment);
  });
};

export const paymentWebhookOperationsService = {
  async list(query: WebhookEventListQuery) {
    const filter: QueryFilter<IPaymentWebhookEvent> = {
      status: query.status,
    };
    if (query.provider) filter.provider = query.provider;
    const [items, total] = await Promise.all([
      PaymentWebhookEvent.find(filter)
        .select(
          "provider providerEventId eventType status attempts nextAttemptAt lockedAt lockExpiresAt processedAt createdAt updatedAt",
        )
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      PaymentWebhookEvent.countDocuments(filter),
    ]);
    return {
      items,
      pagination: buildPaginationMeta(total, query),
    };
  },

  async retry(eventId: string, context: AuditActorContext) {
    const now = new Date();
    const event = await PaymentWebhookEvent.findOne({
      _id: eventId,
      $or: [
        { status: "failed" },
        { status: "processing", lockExpiresAt: { $lte: now } },
      ],
    });
    if (!event) {
      const exists = await PaymentWebhookEvent.exists({ _id: eventId });
      if (!exists) {
        throw ApiError.notFound(
          "Payment webhook event was not found",
          "PAYMENT_WEBHOOK_NOT_FOUND",
        );
      }
      throw ApiError.conflict(
        "Payment webhook event is not retryable",
        undefined,
        "PAYMENT_WEBHOOK_NOT_RETRYABLE",
      );
    }
    event.status = "received";
    event.nextAttemptAt = new Date();
    event.lockedAt = undefined;
    event.lockedBy = undefined;
    event.lockExpiresAt = undefined;
    event.lastError = undefined;
    await event.save();
    await recordAudit({
      context,
      action: "payment_webhook.retried",
      entityType: "PaymentWebhookEvent",
      entityId: event._id,
    });
    return {
      _id: event._id,
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      status: event.status,
      attempts: event.attempts,
      nextAttemptAt: event.nextAttemptAt,
    };
  },
};

const normalizeIncomingHeaders = (
  headers: IncomingHttpHeaders,
): WebhookHeaders =>
  Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) => {
      if (typeof value === "string") return [[name.toLowerCase(), value]];
      if (Array.isArray(value)) return [[name.toLowerCase(), value.join(",")]];
      return [];
    }),
  );

export const ingestPaymentWebhook = async (input: {
  provider: string;
  rawBody: Buffer;
  headers: IncomingHttpHeaders;
}) => {
  if (input.rawBody.length === 0) {
    throw ApiError.badRequest(
      "A raw webhook body is required",
      undefined,
      "WEBHOOK_RAW_BODY_REQUIRED",
    );
  }
  const adapter = getPaymentProvider(input.provider);
  if (adapter.webhookHeaderNames.length === 0) {
    throw new ApiError(503, "Payment adapter has no signature headers configured", {
      code: "PAYMENT_ADAPTER_INVALID",
      expose: true,
    });
  }
  const allHeaders = normalizeIncomingHeaders(input.headers);
  const verified = await adapter.verifyWebhookSignatureAndParse({
    rawBody: input.rawBody,
    headers: allHeaders,
  });
  const persistedHeaders: Record<string, string> = {};
  for (const rawName of adapter.webhookHeaderNames) {
    const name = rawName.toLowerCase();
    const value = allHeaders[name];
    if (!value) {
      throw ApiError.unauthorized(
        "A required payment signature header is missing",
        "PAYMENT_WEBHOOK_SIGNATURE_MISSING",
      );
    }
    persistedHeaders[name] = value;
  }
  if (allHeaders["content-type"]) {
    persistedHeaders["content-type"] = allHeaders["content-type"];
  }
  const envelope: StoredWebhookEnvelope = {
    body: input.rawBody.toString("base64"),
    headers: persistedHeaders,
  };
  const encryptedPayload = encryptSensitiveText(
    JSON.stringify(envelope),
    `payment-webhook:${input.provider}`,
  );

  try {
    return await PaymentWebhookEvent.create({
      provider: input.provider,
      merchantAccountId: verified.merchantAccountId,
      providerEventId: verified.providerEventId,
      eventType: verified.eventType,
      encryptedPayload,
      payloadHash: sha256(input.rawBody),
      status: "received",
      attempts: 0,
    });
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    const existing = await paymentRepository.findWebhook(
      input.provider,
      verified.merchantAccountId,
      verified.providerEventId,
    );
    if (!existing || existing.payloadHash !== sha256(input.rawBody)) {
      throw ApiError.conflict(
        "Webhook event ID was reused with different content",
        undefined,
        "WEBHOOK_EVENT_CONFLICT",
      );
    }
    return existing;
  }
};

export const processPaymentWebhookEvent = async (
  eventId: Types.ObjectId | string,
  workerId = "payment-webhook-worker",
): Promise<"processed" | "ignored" | "busy" | "lease_lost"> => {
  const now = new Date();
  const workerName = workerId.slice(0, 200);
  const event = await PaymentWebhookEvent.findOneAndUpdate(
    {
      _id: eventId,
      $or: [
        { status: { $in: ["received", "failed"] } },
        { status: "processing", lockExpiresAt: { $lte: now } },
      ],
      $and: [
        {
          $or: [
            { nextAttemptAt: { $exists: false } },
            { nextAttemptAt: { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        status: "processing",
        lockedAt: now,
        lockedBy: workerName,
        lockExpiresAt: new Date(now.getTime() + 5 * 60_000),
      },
      $inc: { attempts: 1 },
      $unset: { lastError: 1 },
    },
    { new: true },
  ).select("+encryptedPayload +payloadHash +lastError");
  if (!event) return "busy";

  try {
    const adapter = getPaymentProvider(event.provider);
    const plaintext = decryptSensitiveText(
      event.encryptedPayload,
      `payment-webhook:${event.provider}`,
    );
    const envelope = JSON.parse(plaintext) as StoredWebhookEnvelope;
    const rawBody = Buffer.from(envelope.body, "base64");
    if (sha256(rawBody) !== event.payloadHash) {
      throw new Error("Persisted webhook payload hash does not match");
    }
    const verified = await adapter.verifyWebhookSignatureAndParse({
      rawBody,
      headers: envelope.headers,
    });
    if (
      verified.providerEventId !== event.providerEventId ||
      verified.merchantAccountId !== event.merchantAccountId ||
      verified.eventType !== event.eventType
    ) {
      throw new Error("Reverified webhook metadata does not match");
    }
    const outcome = await runWithLeaseHeartbeat(
      () =>
        adapter.processVerifiedWebhook({
          event: verified,
          rawBody,
          headers: envelope.headers,
        }),
      () =>
        extendPaymentWebhookWorkerLease(event._id, workerName, 5 * 60_000),
      5 * 60_000,
    );
    const completed = await PaymentWebhookEvent.updateOne(
      {
        _id: event._id,
        status: "processing",
        lockedBy: workerName,
      },
      {
        $set: { status: outcome, processedAt: new Date() },
        $unset: {
          nextAttemptAt: 1,
          lastError: 1,
          lockedAt: 1,
          lockedBy: 1,
          lockExpiresAt: 1,
        },
      },
    );
    if (completed.modifiedCount !== 1) return "lease_lost";
    return outcome;
  } catch (error) {
    if (isWorkerLeaseLostError(error)) return "lease_lost";
    const delaySeconds = Math.min(3600, 2 ** Math.min(event.attempts, 10) * 5);
    const lastError =
      error instanceof Error ? error.message.slice(0, 2000) : "Unknown error";
    const failed = await PaymentWebhookEvent.updateOne(
      {
        _id: event._id,
        status: "processing",
        lockedBy: workerName,
      },
      {
        $set: {
          status: "failed",
          nextAttemptAt: new Date(Date.now() + delaySeconds * 1000),
          lastError,
        },
        $unset: {
          lockedAt: 1,
          lockedBy: 1,
          lockExpiresAt: 1,
        },
      },
    );
    if (failed.modifiedCount !== 1) return "lease_lost";
    throw error;
  }
};

export const processNextPaymentWebhookEvent = async (
  workerId = "payment-webhook-worker",
): Promise<
  "idle" | "processed" | "ignored" | "busy" | "lease_lost"
> => {
  const providers = listConfiguredPaymentProviders();
  if (providers.length === 0) return "idle";
  const now = new Date();
  const candidate = await PaymentWebhookEvent.findOne({
    provider: { $in: providers },
    $or: [
      {
        status: { $in: ["received", "failed"] },
        $and: [
          {
            $or: [
              { nextAttemptAt: { $exists: false } },
              { nextAttemptAt: { $lte: now } },
            ],
          },
        ],
      },
      {
        status: "processing",
        lockExpiresAt: { $lte: now },
      },
    ],
  })
    .select("_id")
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  if (!candidate) return "idle";
  return processPaymentWebhookEvent(candidate._id, workerId);
};

export const extendPaymentWebhookWorkerLease = async (
  eventId: Types.ObjectId | string,
  workerId: string,
  leaseMs = 5 * 60_000,
): Promise<boolean> => {
  const now = new Date();
  const result = await PaymentWebhookEvent.updateOne(
    {
      _id: eventId,
      status: "processing",
      lockedBy: workerId.slice(0, 200),
      lockExpiresAt: { $gt: now },
    },
    { $set: { lockExpiresAt: new Date(now.getTime() + leaseMs) } },
  );
  return result.modifiedCount === 1;
};
