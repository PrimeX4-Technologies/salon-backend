import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface TestLock {
  key: string;
  token: string;
}

type AcquireLocks = (
  keys: string[],
  ttlMs: number,
) => Promise<TestLock[] | null>;

const redisMock = vi.hoisted(() => ({
  acquireLocks: vi.fn<AcquireLocks>((keys) =>
    Promise.resolve(
      keys.map((key) => ({ key, token: `token:${key}` })),
    ),
  ),
  extendLock: vi.fn(
    (_key: string, _token: string, _ttlMs: number) =>
      Promise.resolve(true),
  ),
  releaseLocks: vi.fn((_locks: TestLock[]) => Promise.resolve()),
}));

vi.mock("./redis.service.js", () => ({ redisService: redisMock }));

import { withRenewableDistributedLocks } from "./distributed-lock.service.js";

describe("renewable distributed lock guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.acquireLocks.mockImplementation((keys) =>
      Promise.resolve(
        keys.map((key) => ({ key, token: `token:${key}` })),
      ),
    );
    redisMock.extendLock.mockImplementation(() => Promise.resolve(true));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews and verifies every lock when ownership is asserted", async () => {
    const result = await withRenewableDistributedLocks(
      ["branch", "employee"],
      30_000,
      async (guard) => {
        await guard.assertValid();
        return "completed";
      },
    );

    expect(result).toBe("completed");
    // Initial, operation, and final assertions each verify and renew both
    // locks using their ownership tokens.
    expect(redisMock.extendLock).toHaveBeenCalledTimes(6);
    expect(redisMock.releaseLocks).toHaveBeenCalledTimes(1);
  });

  it("fails safely and releases locks when ownership is lost", async () => {
    const operation = vi.fn(() => Promise.resolve("not-run"));
    redisMock.extendLock.mockResolvedValueOnce(false);

    await expect(
      withRenewableDistributedLocks(["branch"], 30_000, operation),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "DISTRIBUTED_LOCK_LOST",
    });
    expect(operation).not.toHaveBeenCalled();
    expect(redisMock.releaseLocks).toHaveBeenCalledTimes(1);
  });

  it("heartbeats while a protected operation is still running", async () => {
    vi.useFakeTimers();
    let finishOperation: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    const execution = withRenewableDistributedLocks(
      ["branch"],
      90,
      async () => {
        markStarted?.();
        await new Promise<void>((resolve) => {
          finishOperation = resolve;
        });
        return "completed";
      },
    );
    await started;
    const callsBeforeHeartbeat = redisMock.extendLock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(30);

    expect(redisMock.extendLock.mock.calls.length).toBeGreaterThan(
      callsBeforeHeartbeat,
    );
    finishOperation?.();
    await expect(execution).resolves.toBe("completed");
  });
});
