import { createHash } from "node:crypto";

import type { Request, RequestHandler } from "express";

import { config } from "../../config/env.js";
import { redisService } from "../../services/redis.service.js";
import { ApiError } from "../../utils/ApiError.js";
import { logger } from "../../utils/logger.js";

type RateLimitKeyGenerator = (request: Request) => string;

export interface RateLimiterOptions {
  namespace: string;
  limit: number;
  windowSeconds: number;
  keyGenerator?: RateLimitKeyGenerator;
  skip?: (request: Request) => boolean;
}

const hashKey = (value: string): string =>
  createHash("sha256").update(value).digest("base64url");

const clientKey: RateLimitKeyGenerator = (request) =>
  request.ip || request.socket.remoteAddress || "unknown";

export const createRateLimiter = ({
  namespace,
  limit,
  windowSeconds,
  keyGenerator = clientKey,
  skip,
}: RateLimiterOptions): RequestHandler => {
  if (!namespace || !Number.isInteger(limit) || limit <= 0) {
    throw new Error("A rate limiter requires a namespace and a positive integer limit");
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
    throw new Error("A rate limiter window must be a positive integer");
  }

  return async (request, response, next): Promise<void> => {
    if (skip?.(request)) {
      next();
      return;
    }

    const key = `rate-limit:${namespace}:${hashKey(keyGenerator(request))}`;

    try {
      const result = await redisService.incrementWithExpiry(key, windowSeconds);
      const remaining = Math.max(limit - result.count, 0);
      const resetSeconds = result.ttlSeconds || windowSeconds;

      response.setHeader("RateLimit-Limit", limit);
      response.setHeader("RateLimit-Remaining", remaining);
      response.setHeader(
        "RateLimit-Reset",
        Math.ceil(Date.now() / 1000) + resetSeconds,
      );

      if (result.count > limit) {
        response.setHeader("Retry-After", resetSeconds);
        next(
          new ApiError(
            429,
            "Too many requests. Please try again later.",
            { code: "RATE_LIMIT_EXCEEDED" },
          ),
        );
        return;
      }

      next();
    } catch (error) {
      logger.error("Redis rate limiter failed", error, {
        namespace,
        path: request.path,
      });

      if (config.NODE_ENV !== "production") {
        next();
        return;
      }

      next(
        new ApiError(
          503,
          "Request protection is temporarily unavailable",
          { code: "RATE_LIMIT_UNAVAILABLE" },
        ),
      );
    }
  };
};

export const authRateLimiter = createRateLimiter({
  namespace: "auth",
  limit: config.AUTH_RATE_LIMIT_MAX,
  windowSeconds: config.AUTH_RATE_LIMIT_WINDOW_SECONDS,
});

export const authRefreshRateLimiter = createRateLimiter({
  namespace: "auth-refresh",
  limit: Math.max(config.AUTH_RATE_LIMIT_MAX * 3, 30),
  windowSeconds: config.AUTH_RATE_LIMIT_WINDOW_SECONDS,
});

export const apiRateLimiter = createRateLimiter({
  namespace: "api",
  limit: config.API_RATE_LIMIT_MAX,
  windowSeconds: config.API_RATE_LIMIT_WINDOW_SECONDS,
  skip: (request) => request.method === "OPTIONS",
});

export const paymentWebhookRateLimiter = createRateLimiter({
  namespace: "payment-webhook",
  limit: config.PAYMENT_WEBHOOK_RATE_LIMIT_MAX,
  windowSeconds: config.PAYMENT_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS,
});
