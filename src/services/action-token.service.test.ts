import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const values = new Map<string, unknown>();

  return {
    values,
    redis: {
      get: vi.fn(<T>(key: string): Promise<T | null> =>
        Promise.resolve((values.get(key) as T | undefined) ?? null),
      ),
      set: vi.fn(<T>(key: string, value: T): Promise<void> => {
        values.set(key, value);
        return Promise.resolve();
      }),
      delete: vi.fn((key: string): Promise<boolean> =>
        Promise.resolve(values.delete(key)),
      ),
      getAndDeletePointedValue: vi.fn(
        <T>(
          pointerKey: string,
          expectedPointerValue: string,
          valueKey: string,
        ): Promise<T | null> => {
          if (values.get(pointerKey) !== expectedPointerValue) {
            return Promise.resolve(null);
          }
          const value = values.get(valueKey) as T | undefined;
          values.delete(pointerKey);
          values.delete(valueKey);
          return Promise.resolve(value ?? null);
        },
      ),
    },
  };
});

vi.mock("./redis.service.js", () => ({ redisService: state.redis }));

const { ActionTokenService } = await import("./action-token.service.js");

describe("ActionTokenService", () => {
  beforeEach(() => {
    state.values.clear();
  });

  it("accepts only the latest token when issuance races", async () => {
    const service = new ActionTokenService();
    const [superseded, latest] = await Promise.all([
      service.issue(
        "password-reset",
        { userId: "user-1", tokenVersion: 3 },
        900,
      ),
      service.issue(
        "password-reset",
        { userId: "user-1", tokenVersion: 3 },
        900,
      ),
    ]);

    await expect(
      service.consume("password-reset", superseded.rawToken),
    ).rejects.toMatchObject({ code: "INVALID_ACTION_TOKEN" });
    await expect(
      service.consume("password-reset", latest.rawToken),
    ).resolves.toMatchObject({
      purpose: "password-reset",
      userId: "user-1",
      tokenVersion: 3,
    });
  });

  it("consumes the latest token only once", async () => {
    const service = new ActionTokenService();
    const issued = await service.issue(
      "email-verification",
      { userId: "user-1", tokenVersion: 1, subject: "user@example.com" },
      900,
    );

    const results = await Promise.allSettled([
      service.consume("email-verification", issued.rawToken),
      service.consume("email-verification", issued.rawToken),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
  });

  it("does not revoke a newer token when cleanup targets an older issue", async () => {
    const service = new ActionTokenService();
    const [superseded, latest] = await Promise.all([
      service.issue(
        "password-reset",
        { userId: "user-1", tokenVersion: 2 },
        900,
      ),
      service.issue(
        "password-reset",
        { userId: "user-1", tokenVersion: 2 },
        900,
      ),
    ]);

    await service.revokeIssuedToken(
      "password-reset",
      "user-1",
      superseded.rawToken,
    );

    await expect(
      service.consume("password-reset", latest.rawToken),
    ).resolves.toMatchObject({ userId: "user-1", tokenVersion: 2 });
  });
});
