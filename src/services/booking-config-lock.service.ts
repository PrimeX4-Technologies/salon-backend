import type { Types } from "mongoose";

import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";
import {
  redisService,
  type DistributedReadWriteLease,
} from "./redis.service.js";

export const BOOKING_CONFIG_LEASE_TTL_MS = 90_000;

type BranchId = string | Types.ObjectId;
type BookingConfigLeaseMode = "read" | "write";

export interface BookingConfigLeaseGuard {
  assertValid(): Promise<void>;
}

export const bookingConfigLeaseScope = (branchId: string): string =>
  `booking:config:${branchId}`;

const normalizeBranchIds = (branchIds: readonly BranchId[]): string[] =>
  [...new Set(branchIds.map((branchId) => branchId.toString().trim()))]
    .filter(Boolean)
    .sort();

const leaseUnavailable = (cause?: unknown): ApiError =>
  new ApiError(
    503,
    "Booking configuration locking is temporarily unavailable; retry shortly",
    {
      cause,
      code: "BOOKING_CONFIG_LOCK_UNAVAILABLE",
    },
  );

const leaseLost = (cause?: unknown): ApiError =>
  new ApiError(
    503,
    "Booking configuration lock was lost; verify the change before retrying",
    {
      cause,
      code: "BOOKING_CONFIG_LEASE_LOST",
    },
  );

const withBookingConfigLeases = async <T>(
  branchIds: readonly BranchId[],
  mode: BookingConfigLeaseMode,
  operation: (guard: BookingConfigLeaseGuard) => Promise<T>,
): Promise<T> => {
  const normalizedBranchIds = normalizeBranchIds(branchIds);
  if (normalizedBranchIds.length === 0) {
    return operation({ assertValid: () => Promise.resolve() });
  }

  const leases: DistributedReadWriteLease[] = [];
  try {
    for (const branchId of normalizedBranchIds) {
      let lease: DistributedReadWriteLease | null;
      try {
        lease = await redisService.acquireReadWriteLease(
          bookingConfigLeaseScope(branchId),
          mode,
          BOOKING_CONFIG_LEASE_TTL_MS,
        );
      } catch (error) {
        throw leaseUnavailable(error);
      }

      if (!lease) {
        throw ApiError.conflict(
          mode === "write"
            ? "Booking configuration is currently in use; retry shortly"
            : "Booking configuration is currently being updated; retry shortly",
          { branchIds: normalizedBranchIds },
          mode === "write"
            ? "BOOKING_CONFIG_IN_USE"
            : "BOOKING_CONFIGURATION_LOCKED",
        );
      }
      leases.push(lease);
    }
  } catch (error) {
    await Promise.allSettled(
      [...leases]
        .reverse()
        .map((lease) => redisService.releaseReadWriteLease(lease)),
    );
    throw error;
  }

  let stopped = false;
  let lost = false;
  let renewalPromise: Promise<void> | undefined;

  const renewLeases = (): void => {
    if (stopped || renewalPromise) return;

    renewalPromise = Promise.all(
      leases.map((lease) =>
        redisService.extendReadWriteLease(
          lease,
          BOOKING_CONFIG_LEASE_TTL_MS,
        ),
      ),
    )
      .then((results) => {
        if (results.some((extended) => !extended)) lost = true;
      })
      .catch((error: unknown) => {
        lost = true;
        logger.warn("Booking configuration lease renewal failed", {
          branchIds: normalizedBranchIds,
          mode,
          error,
        });
      })
      .finally(() => {
        renewalPromise = undefined;
      });
  };

  const timer = setInterval(renewLeases, BOOKING_CONFIG_LEASE_TTL_MS / 3);
  timer.unref();

  const guard: BookingConfigLeaseGuard = {
    assertValid: async (): Promise<void> => {
      if (lost) throw leaseLost();

      try {
        const valid = await Promise.all(
          leases.map((lease) => redisService.isReadWriteLeaseValid(lease)),
        );
        if (valid.some((isValid) => !isValid)) {
          lost = true;
          throw leaseLost();
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        lost = true;
        throw leaseLost(error);
      }
    },
  };

  try {
    await guard.assertValid();
    const result = await operation(guard);
    await guard.assertValid();
    return result;
  } finally {
    stopped = true;
    clearInterval(timer);
    if (renewalPromise) await renewalPromise;

    const releases = await Promise.allSettled(
      [...leases]
        .reverse()
        .map((lease) => redisService.releaseReadWriteLease(lease)),
    );
    if (releases.some((release) => release.status === "rejected")) {
      logger.warn(
        "One or more booking configuration leases could not be released; they will expire",
        { branchIds: normalizedBranchIds, mode },
      );
    }
  }
};

export const withBookingConfigReadLeases = async <T>(
  branchIds: readonly BranchId[],
  operation: (guard: BookingConfigLeaseGuard) => Promise<T>,
): Promise<T> => withBookingConfigLeases(branchIds, "read", operation);

export const withBookingConfigReadLease = async <T>(
  branchId: BranchId,
  operation: (guard: BookingConfigLeaseGuard) => Promise<T>,
): Promise<T> => withBookingConfigReadLeases([branchId], operation);

export const withBookingConfigWriteLeases = async <T>(
  branchIds: readonly BranchId[],
  operation: (guard: BookingConfigLeaseGuard) => Promise<T>,
): Promise<T> => withBookingConfigLeases(branchIds, "write", operation);

export const withBookingConfigWriteLease = async <T>(
  branchId: BranchId,
  operation: (guard: BookingConfigLeaseGuard) => Promise<T>,
): Promise<T> => withBookingConfigWriteLeases([branchId], operation);
