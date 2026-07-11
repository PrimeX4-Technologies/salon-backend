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
}

export const redisService = new RedisService();
