import type { RedisOptions } from "ioredis";

export const redisOptions: RedisOptions = {
  lazyConnect: true,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 2,
  connectTimeout: 5_000,
  commandTimeout: 3_000,
  retryStrategy: (attempt: number) => Math.min(attempt * 100, 2_000),
};
