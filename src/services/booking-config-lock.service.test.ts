import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

interface TestLease {
  scope: string;
  mode: "read" | "write";
  token: string;
}

type AcquireLease = (
  scope: string,
  mode: "read" | "write",
) => Promise<TestLease | null>;

const redisMock = vi.hoisted(() => ({
  acquireReadWriteLease: vi.fn<AcquireLease>((scope, mode) =>
    Promise.resolve({
      scope,
      mode,
      token: `token:${scope}`,
    }),
  ),
  extendReadWriteLease: vi.fn(() => Promise.resolve(true)),
  isReadWriteLeaseValid: vi.fn(() => Promise.resolve(true)),
  releaseReadWriteLease: vi.fn(
    (_lease: TestLease) => Promise.resolve(true),
  ),
}));

vi.mock("./redis.service.js", () => ({ redisService: redisMock }));

import {
  withBookingConfigReadLeases,
  withBookingConfigWriteLease,
  withBookingConfigWriteLeases,
} from "./booking-config-lock.service.js";

describe("booking configuration writer leases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.acquireReadWriteLease.mockImplementation(
      (scope: string, mode: "read" | "write") => Promise.resolve({
        scope,
        mode,
        token: `token:${scope}`,
      }),
    );
    redisMock.extendReadWriteLease.mockImplementation(() =>
      Promise.resolve(true),
    );
    redisMock.isReadWriteLeaseValid.mockImplementation(() =>
      Promise.resolve(true),
    );
    redisMock.releaseReadWriteLease.mockImplementation(() =>
      Promise.resolve(true),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates branches and acquires multi-branch leases deterministically", async () => {
    const result = await withBookingConfigWriteLeases(
      ["branch-b", "branch-a", "branch-b"],
      async (guard) => {
        await guard.assertValid();
        return "completed";
      },
    );

    expect(result).toBe("completed");
    expect(
      redisMock.acquireReadWriteLease.mock.calls.map(([scope]) => scope),
    ).toEqual([
      "booking:config:branch-a",
      "booking:config:branch-b",
    ]);
    expect(
      redisMock.releaseReadWriteLease.mock.calls.map(
        ([lease]) => lease.scope,
      ),
    ).toEqual([
      "booking:config:branch-b",
      "booking:config:branch-a",
    ]);
  });

  it("releases partial acquisitions when another writer or reader is active", async () => {
    redisMock.acquireReadWriteLease
      .mockResolvedValueOnce({
        scope: "booking:config:branch-a",
        mode: "write",
        token: "token:a",
      })
      .mockResolvedValueOnce(null);

    await expect(
      withBookingConfigWriteLeases(
        ["branch-a", "branch-b"],
        () => Promise.resolve("not-run"),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "BOOKING_CONFIG_IN_USE",
    });
    expect(redisMock.releaseReadWriteLease).toHaveBeenCalledTimes(1);
    expect(redisMock.releaseReadWriteLease).toHaveBeenCalledWith({
      scope: "booking:config:branch-a",
      mode: "write",
      token: "token:a",
    });
  });

  it("acquires renewable shared read leases in deterministic branch order", async () => {
    vi.useFakeTimers();
    let finishOperation: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    const execution = withBookingConfigReadLeases(
      ["branch-b", "branch-a", "branch-b"],
      async () => {
        markStarted?.();
        await new Promise<void>((resolve) => {
          finishOperation = resolve;
        });
        return "completed";
      },
    );
    await started;

    expect(
      redisMock.acquireReadWriteLease.mock.calls.map(
        ([scope, mode]) => [scope, mode],
      ),
    ).toEqual([
      ["booking:config:branch-a", "read"],
      ["booking:config:branch-b", "read"],
    ]);
    const callsBeforeHeartbeat =
      redisMock.extendReadWriteLease.mock.calls.length;

    await vi.advanceTimersByTimeAsync(30_000);

    expect(redisMock.extendReadWriteLease.mock.calls.length).toBeGreaterThan(
      callsBeforeHeartbeat,
    );
    finishOperation?.();
    await expect(execution).resolves.toBe("completed");
  });

  it("cleans up partial read leases when a writer owns a later branch", async () => {
    redisMock.acquireReadWriteLease
      .mockResolvedValueOnce({
        scope: "booking:config:branch-a",
        mode: "read",
        token: "token:a",
      })
      .mockResolvedValueOnce(null);

    await expect(
      withBookingConfigReadLeases(
        ["branch-a", "branch-b"],
        () => Promise.resolve("not-run"),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "BOOKING_CONFIGURATION_LOCKED",
    });
    expect(redisMock.releaseReadWriteLease).toHaveBeenCalledTimes(1);
  });

  it("allows shared readers while excluding a configuration writer", async () => {
    const readerTokens = new Set<string>();
    let writerToken: string | undefined;
    let tokenSequence = 0;
    redisMock.acquireReadWriteLease.mockImplementation((scope, mode) => {
      if (
        (mode === "read" && writerToken) ||
        (mode === "write" &&
          (writerToken !== undefined || readerTokens.size > 0))
      ) {
        return Promise.resolve(null);
      }
      const token = `token:${++tokenSequence}`;
      if (mode === "read") readerTokens.add(token);
      else writerToken = token;
      return Promise.resolve({ scope, mode, token });
    });
    redisMock.releaseReadWriteLease.mockImplementation((lease) => {
      if (lease.mode === "read") readerTokens.delete(lease.token);
      else if (writerToken === lease.token) writerToken = undefined;
      return Promise.resolve(true);
    });

    let finishReader: (() => void) | undefined;
    let markReaderStarted: (() => void) | undefined;
    const readerStarted = new Promise<void>((resolve) => {
      markReaderStarted = resolve;
    });
    const reader = withBookingConfigReadLeases(
      ["branch-a"],
      async () => {
        markReaderStarted?.();
        await new Promise<void>((resolve) => {
          finishReader = resolve;
        });
        return "reader-completed";
      },
    );
    await readerStarted;

    await expect(
      withBookingConfigWriteLease(
        "branch-a",
        () => Promise.resolve("writer-should-not-run"),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "BOOKING_CONFIG_IN_USE",
    });

    finishReader?.();
    await expect(reader).resolves.toBe("reader-completed");
    await expect(
      withBookingConfigWriteLease(
        "branch-a",
        () => Promise.resolve("writer-completed"),
      ),
    ).resolves.toBe("writer-completed");
  });

  it("always releases a lease when the protected operation fails", async () => {
    const failure = new Error("mutation failed");

    await expect(
      withBookingConfigWriteLease("branch-a", () =>
        Promise.reject(failure),
      ),
    ).rejects.toBe(failure);
    expect(redisMock.releaseReadWriteLease).toHaveBeenCalledTimes(1);
  });

  it("does not contact Redis when no branch can be affected", async () => {
    const result = await withBookingConfigWriteLeases([], async (guard) => {
      await guard.assertValid();
      return "completed";
    });

    expect(result).toBe("completed");
    expect(redisMock.acquireReadWriteLease).not.toHaveBeenCalled();
  });
});
