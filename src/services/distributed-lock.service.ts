import { ApiError } from "../utils/ApiError.js";
import { logger } from "../utils/logger.js";
import {
  redisService,
  type DistributedLock,
} from "./redis.service.js";

export interface DistributedLockGuard {
  assertValid(): Promise<void>;
}

export interface DistributedLockRunOptions {
  contentionMessage?: string;
  contentionCode?: string;
  unavailableMessage?: string;
  unavailableCode?: string;
  lostMessage?: string;
  lostCode?: string;
  logContext?: Record<string, unknown>;
}

const unavailableError = (
  options: DistributedLockRunOptions,
  cause: unknown,
): ApiError =>
  new ApiError(
    503,
    options.unavailableMessage ??
      "Distributed locking is temporarily unavailable; retry shortly",
    {
      cause,
      code: options.unavailableCode ?? "DISTRIBUTED_LOCK_UNAVAILABLE",
    },
  );

const lostError = (
  options: DistributedLockRunOptions,
  cause?: unknown,
): ApiError =>
  new ApiError(
    503,
    options.lostMessage ??
      "Distributed lock ownership was lost; verify the operation before retrying",
    {
      cause,
      code: options.lostCode ?? "DISTRIBUTED_LOCK_LOST",
    },
  );

export const withRenewableDistributedLocks = async <T>(
  keys: readonly string[],
  ttlMs: number,
  operation: (guard: DistributedLockGuard) => Promise<T>,
  options: DistributedLockRunOptions = {},
): Promise<T> => {
  let locks: DistributedLock[];
  try {
    const acquired = await redisService.acquireLocks([...keys], ttlMs);
    if (!acquired) {
      throw ApiError.conflict(
        options.contentionMessage ??
          "Another protected operation is in progress; retry shortly",
        undefined,
        options.contentionCode ?? "DISTRIBUTED_LOCK_IN_PROGRESS",
      );
    }
    locks = acquired;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw unavailableError(options, error);
  }

  let stopped = false;
  let lost = false;
  let renewalError: unknown;
  let renewalPromise: Promise<boolean> | undefined;

  const renew = (): Promise<boolean> => {
    if (renewalPromise) return renewalPromise;
    renewalPromise = Promise.all(
      locks.map(({ key, token }) =>
        redisService.extendLock(key, token, ttlMs),
      ),
    )
      .then((results) => {
        const valid = results.every(Boolean);
        if (!valid) lost = true;
        return valid;
      })
      .catch((error: unknown) => {
        lost = true;
        renewalError = error;
        return false;
      })
      .finally(() => {
        renewalPromise = undefined;
      });
    return renewalPromise;
  };

  const timer = setInterval(() => {
    if (stopped) return;
    void renew().then((valid) => {
      if (!valid) {
        logger.warn("Distributed lock renewal failed", {
          keys,
          ...options.logContext,
          ...(renewalError !== undefined ? { error: renewalError } : {}),
        });
      }
    });
  }, Math.max(1, Math.floor(ttlMs / 3)));
  timer.unref();

  const guard: DistributedLockGuard = {
    assertValid: async (): Promise<void> => {
      if (lost || !(await renew())) {
        throw lostError(options, renewalError);
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
    await redisService.releaseLocks(locks);
  }
};
