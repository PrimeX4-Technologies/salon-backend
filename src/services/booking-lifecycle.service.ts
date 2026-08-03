import { expireDueBookingHoldsForSystem } from "./booking.service.js";
import { expireDueBookingQuotesForSystem } from "./inquiry.service.js";
import { expireDueWaitlistEntriesForSystem } from "./waitlist.service.js";

export interface BookingLifecycleExpirySummary {
  pendingAdvanceHoldsExpired: number;
  quotesExpired: number;
  waitlistEntriesExpired: number;
  totalExpired: number;
}

export interface BookingLifecycleExpiryOptions {
  now?: Date;
  batchSize?: number;
  workerId?: string;
}

const normalizeBatchSize = (batchSize: number | undefined): number => {
  if (batchSize === undefined) return 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error("Booking lifecycle batch size must be an integer from 1 to 500");
  }
  return batchSize;
};

export const expireDueBookingLifecycleRecords = async (
  options: BookingLifecycleExpiryOptions = {},
): Promise<BookingLifecycleExpirySummary> => {
  const now = options.now ?? new Date();
  const batchSize = normalizeBatchSize(options.batchSize);
  const common = {
    now,
    limit: batchSize,
    workerId: options.workerId,
  };
  const [holds, quotes, waitlist] = await Promise.all([
    expireDueBookingHoldsForSystem(common),
    expireDueBookingQuotesForSystem(common),
    expireDueWaitlistEntriesForSystem(common),
  ]);
  const totalExpired = holds.expired + quotes.expired + waitlist.expired;
  return {
    pendingAdvanceHoldsExpired: holds.expired,
    quotesExpired: quotes.expired,
    waitlistEntriesExpired: waitlist.expired,
    totalExpired,
  };
};

export const processBookingLifecycleExpirations = async (
  workerId: string,
): Promise<"processed" | "idle"> => {
  const result = await expireDueBookingLifecycleRecords({ workerId });
  return result.totalExpired > 0 ? "processed" : "idle";
};

