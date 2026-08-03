import { randomUUID } from "node:crypto";

import { Redis } from "ioredis";

import { config } from "../config/env.js";
import { redisOptions } from "../config/redis.js";
import { logger } from "../utils/logger.js";

const RELEASE_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

const EXTEND_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end
  return 0
`;

const INCREMENT_WITH_EXPIRY_SCRIPT = `
  local count = redis.call("INCR", KEYS[1])
  if count == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[1])
  end
  local ttl = redis.call("TTL", KEYS[1])
  return { count, ttl }
`;

const GET_AND_DELETE_POINTED_VALUE_SCRIPT = `
  if redis.call("GET", KEYS[1]) ~= ARGV[1] then
    return nil
  end

  local value = redis.call("GET", KEYS[2])
  if value == false then
    redis.call("DEL", KEYS[1])
    return nil
  end

  redis.call("DEL", KEYS[1], KEYS[2])
  return value
`;

const ACQUIRE_READ_LEASE_SCRIPT = `
  local time = redis.call("TIME")
  local now = (time[1] * 1000) + math.floor(time[2] / 1000)
  redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
  if redis.call("EXISTS", KEYS[1]) == 1 then
    return 0
  end
  local expiresAt = now + tonumber(ARGV[2])
  redis.call("ZADD", KEYS[2], expiresAt, ARGV[1])
  local latest = redis.call("ZREVRANGE", KEYS[2], 0, 0, "WITHSCORES")
  if #latest == 2 then
    redis.call("PEXPIRE", KEYS[2], math.max(tonumber(latest[2]) - now + 60000, 60000))
  end
  return 1
`;

const ACQUIRE_WRITE_LEASE_SCRIPT = `
  local time = redis.call("TIME")
  local now = (time[1] * 1000) + math.floor(time[2] / 1000)
  redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
  if redis.call("EXISTS", KEYS[1]) == 1 or redis.call("ZCARD", KEYS[2]) > 0 then
    return 0
  end
  redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2])
  return 1
`;

const EXTEND_READ_LEASE_SCRIPT = `
  local time = redis.call("TIME")
  local now = (time[1] * 1000) + math.floor(time[2] / 1000)
  redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
  if redis.call("EXISTS", KEYS[1]) == 1 or redis.call("ZSCORE", KEYS[2], ARGV[1]) == false then
    return 0
  end
  local expiresAt = now + tonumber(ARGV[2])
  redis.call("ZADD", KEYS[2], expiresAt, ARGV[1])
  local latest = redis.call("ZREVRANGE", KEYS[2], 0, 0, "WITHSCORES")
  if #latest == 2 then
    redis.call("PEXPIRE", KEYS[2], math.max(tonumber(latest[2]) - now + 60000, 60000))
  end
  return 1
`;

const EXTEND_WRITE_LEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end
  return 0
`;

const VALIDATE_READ_LEASE_SCRIPT = `
  local time = redis.call("TIME")
  local now = (time[1] * 1000) + math.floor(time[2] / 1000)
  redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", now)
  if redis.call("EXISTS", KEYS[1]) == 1 then
    return 0
  end
  return redis.call("ZSCORE", KEYS[2], ARGV[1]) ~= false and 1 or 0
`;

const VALIDATE_WRITE_LEASE_SCRIPT = `
  return redis.call("GET", KEYS[1]) == ARGV[1] and 1 or 0
`;

const RELEASE_READ_LEASE_SCRIPT = `
  return redis.call("ZREM", KEYS[2], ARGV[1])
`;

const RELEASE_WRITE_LEASE_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  end
  return 0
`;

export interface DistributedLock {
  key: string;
  token: string;
}

export interface DistributedReadWriteLease {
  scope: string;
  mode: "read" | "write";
  token: string;
}

class RedisService {
  private readonly client: Redis;

  constructor() {
    this.client = new Redis(config.REDIS_URL, redisOptions);

    this.client.on("ready", () => logger.info("Redis connection established"));
    this.client.on("error", (error: Error) => logger.error("Redis client error", error));
    this.client.on("close", () => logger.warn("Redis connection closed"));
  }

  async connect(): Promise<void> {
    if (this.client.status === "ready") return;
    if (this.client.status === "wait" || this.client.status === "end") {
      await this.client.connect();
    }

    await this.client.ping();
  }

  async disconnect(): Promise<void> {
    if (this.client.status === "end") return;

    if (this.client.status !== "ready") {
      this.client.disconnect(false);
      return;
    }

    try {
      await this.client.quit();
    } catch (error) {
      this.client.disconnect(false);
      logger.error("Redis quit failed; connection force-closed", error);
    }
  }

  isReady(): boolean {
    return this.client.status === "ready";
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    return value === null ? null : (JSON.parse(value) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("Redis value must be JSON serializable");

    if (ttlSeconds !== undefined) {
      if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
        throw new Error("Redis TTL must be a positive integer");
      }
      await this.client.set(key, serialized, "EX", ttlSeconds);
      return;
    }

    await this.client.set(key, serialized);
  }

  async delete(key: string): Promise<boolean> {
    return (await this.client.del(key)) > 0;
  }

  async deleteMany(keys: string[]): Promise<number> {
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  async getAndDelete<T>(key: string): Promise<T | null> {
    const value = await this.client.getdel(key);
    return value === null ? null : (JSON.parse(value) as T);
  }

  async getAndDeletePointedValue<T>(
    pointerKey: string,
    expectedPointerValue: string,
    valueKey: string,
  ): Promise<T | null> {
    const serializedPointer = JSON.stringify(expectedPointerValue);
    const value = await this.client.eval(
      GET_AND_DELETE_POINTED_VALUE_SCRIPT,
      2,
      pointerKey,
      valueKey,
      serializedPointer,
    );
    if (value === null) return null;
    if (typeof value !== "string") {
      throw new Error("Redis pointed-value operation returned an invalid value");
    }
    return JSON.parse(value) as T;
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) > 0;
  }

  async incrementWithExpiry(
    key: string,
    ttlSeconds: number,
  ): Promise<{ count: number; ttlSeconds: number }> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error("Redis counter TTL must be a positive integer");
    }

    const result = (await this.client.eval(
      INCREMENT_WITH_EXPIRY_SCRIPT,
      1,
      key,
      ttlSeconds,
    )) as [number, number];

    return {
      count: Number(result[0]),
      ttlSeconds: Math.max(Number(result[1]), 0),
    };
  }

  async addToSortedSet(
    key: string,
    member: string,
    score: number,
    ttlSeconds?: number,
  ): Promise<void> {
    await this.client.zadd(key, score, member);
    if (ttlSeconds !== undefined) {
      if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
        throw new Error("Redis sorted-set TTL must be a positive integer");
      }
      await this.client.expire(key, ttlSeconds);
    }
  }

  async getSortedSetByScore(
    key: string,
    minimum: number,
    maximum: number,
  ): Promise<string[]> {
    return this.client.zrangebyscore(key, minimum, maximum);
  }

  async removeFromSortedSet(key: string, member: string): Promise<void> {
    await this.client.zrem(key, member);
  }

  async removeSortedSetByScore(
    key: string,
    minimum: number,
    maximum: number,
  ): Promise<number> {
    return this.client.zremrangebyscore(key, minimum, maximum);
  }

  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("Lock TTL must be a positive integer");
    }

    const token = randomUUID();
    const result = await this.client.set(`lock:${key}`, token, "PX", ttlMs, "NX");
    return result === "OK" ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<boolean> {
    const result = await this.client.eval(RELEASE_LOCK_SCRIPT, 1, `lock:${key}`, token);
    return result === 1;
  }

  async extendLock(key: string, token: string, ttlMs: number): Promise<boolean> {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("Lock TTL must be a positive integer");
    }
    const result = await this.client.eval(
      EXTEND_LOCK_SCRIPT,
      1,
      `lock:${key}`,
      token,
      ttlMs,
    );
    return result === 1;
  }

  async acquireLocks(
    keys: string[],
    ttlMs: number,
  ): Promise<DistributedLock[] | null> {
    const orderedKeys = [...new Set(keys)].sort();
    const acquired: DistributedLock[] = [];

    try {
      for (const key of orderedKeys) {
        const token = await this.acquireLock(key, ttlMs);
        if (!token) {
          await this.releaseLocks(acquired);
          return null;
        }
        acquired.push({ key, token });
      }
    } catch (error) {
      await this.releaseLocks(acquired);
      throw error;
    }

    return acquired;
  }

  async releaseLocks(locks: DistributedLock[]): Promise<void> {
    await Promise.allSettled(
      [...locks]
        .reverse()
        .map(({ key, token }) => this.releaseLock(key, token)),
    );
  }

  private readWriteLeaseKeys(scope: string): {
    writerKey: string;
    readersKey: string;
  } {
    const normalizedScope = scope.trim();
    if (!normalizedScope) {
      throw new Error("A read/write lease requires a non-empty scope");
    }
    return {
      writerKey: `${normalizedScope}:writer`,
      readersKey: `${normalizedScope}:readers`,
    };
  }

  async acquireReadWriteLease(
    scope: string,
    mode: "read" | "write",
    ttlMs: number,
  ): Promise<DistributedReadWriteLease | null> {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("Read/write lease TTL must be a positive integer");
    }
    const token = randomUUID();
    const { writerKey, readersKey } = this.readWriteLeaseKeys(scope);
    const script =
      mode === "read"
        ? ACQUIRE_READ_LEASE_SCRIPT
        : ACQUIRE_WRITE_LEASE_SCRIPT;
    const result = await this.client.eval(
      script,
      2,
      writerKey,
      readersKey,
      token,
      ttlMs,
    );
    return result === 1 ? { scope, mode, token } : null;
  }

  async extendReadWriteLease(
    lease: DistributedReadWriteLease,
    ttlMs: number,
  ): Promise<boolean> {
    if (!Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("Read/write lease TTL must be a positive integer");
    }
    const { writerKey, readersKey } = this.readWriteLeaseKeys(lease.scope);
    const script =
      lease.mode === "read"
        ? EXTEND_READ_LEASE_SCRIPT
        : EXTEND_WRITE_LEASE_SCRIPT;
    const result = await this.client.eval(
      script,
      2,
      writerKey,
      readersKey,
      lease.token,
      ttlMs,
    );
    return result === 1;
  }

  async isReadWriteLeaseValid(
    lease: DistributedReadWriteLease,
  ): Promise<boolean> {
    const { writerKey, readersKey } = this.readWriteLeaseKeys(lease.scope);
    const script =
      lease.mode === "read"
        ? VALIDATE_READ_LEASE_SCRIPT
        : VALIDATE_WRITE_LEASE_SCRIPT;
    const result = await this.client.eval(
      script,
      2,
      writerKey,
      readersKey,
      lease.token,
    );
    return result === 1;
  }

  async releaseReadWriteLease(
    lease: DistributedReadWriteLease,
  ): Promise<boolean> {
    const { writerKey, readersKey } = this.readWriteLeaseKeys(lease.scope);
    const script =
      lease.mode === "read"
        ? RELEASE_READ_LEASE_SCRIPT
        : RELEASE_WRITE_LEASE_SCRIPT;
    const result = await this.client.eval(
      script,
      2,
      writerKey,
      readersKey,
      lease.token,
    );
    return result === 1;
  }
}

export const redisService = new RedisService();
