import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import "../providers/index.js";
import { connectDB, disconnectDB } from "../config/database.js";
import { config } from "../config/env.js";
import {
  claimAndRunNextIntegrationJob,
} from "../services/integration.service.js";
import {
  claimAndDeliverNextNotification,
} from "../services/notification.service.js";
import {
  claimAndPublishNextOutboxEvent,
} from "../services/operations.service.js";
import {
  processNextPaymentWebhookEvent,
} from "../services/payment.service.js";
import {
  processBookingLifecycleExpirations,
} from "../services/booking-lifecycle.service.js";
import { redisService } from "../services/redis.service.js";
import { logger } from "../utils/logger.js";

type WorkerKind =
  | "all"
  | "outbox"
  | "notifications"
  | "integrations"
  | "payment-webhooks"
  | "booking-lifecycle";

const supportedKinds = new Set<WorkerKind>([
  "all",
  "outbox",
  "notifications",
  "integrations",
  "payment-webhooks",
  "booking-lifecycle",
]);
const requestedKind = (process.argv[2] ?? "all") as WorkerKind;
if (!supportedKinds.has(requestedKind)) {
  throw new Error(
    `Unknown worker kind '${requestedKind}'. Expected ${[...supportedKinds].join(", ")}`,
  );
}

const workerId = `${process.env.HOSTNAME ?? "worker"}:${process.pid}:${randomUUID()}`;
const abortController = new AbortController();
let shuttingDown = false;
let shutdownDeadline: NodeJS.Timeout | undefined;

const includes = (kind: Exclude<WorkerKind, "all">): boolean =>
  requestedKind === "all" || requestedKind === kind;

const runOneCycle = async (): Promise<boolean> => {
  const outcomes = await Promise.all([
    includes("outbox")
      ? claimAndPublishNextOutboxEvent(workerId)
      : Promise.resolve("idle" as const),
    includes("notifications")
      ? claimAndDeliverNextNotification(workerId)
      : Promise.resolve("idle" as const),
    includes("integrations")
      ? claimAndRunNextIntegrationJob(workerId)
      : Promise.resolve("idle" as const),
    includes("payment-webhooks")
      ? processNextPaymentWebhookEvent(workerId)
      : Promise.resolve("idle" as const),
    includes("booking-lifecycle")
      ? processBookingLifecycleExpirations(workerId)
      : Promise.resolve("idle" as const),
  ]);
  return outcomes.some((outcome) => outcome !== "idle" && outcome !== "busy");
};

const shutdown = (signal: string): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Operational worker shutdown requested", { signal, workerId });
  abortController.abort();
  shutdownDeadline = setTimeout(() => {
    logger.error("Operational worker shutdown timed out", undefined, {
      signal,
      workerId,
    });
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  shutdownDeadline.unref();
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

const main = async (): Promise<void> => {
  const connectionResults = await Promise.allSettled([
    connectDB(),
    redisService.connect(),
  ]);
  const connectionErrors = connectionResults
    .filter(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    )
    .map((result) => result.reason as unknown);
  if (connectionErrors.length > 0) {
    await Promise.allSettled([redisService.disconnect(), disconnectDB()]);
    throw new AggregateError(
      connectionErrors,
      "One or more worker infrastructure connections failed",
    );
  }

  logger.info("Operational worker started", {
    workerId,
    kind: requestedKind,
  });

  try {
    while (!shuttingDown) {
      try {
        const worked = await runOneCycle();
        if (!worked) {
          await delay(1_000, undefined, {
            signal: abortController.signal,
          });
        }
      } catch (error) {
        if (shuttingDown) break;
        logger.error("Operational worker cycle failed", error, {
          workerId,
          kind: requestedKind,
        });
        await delay(2_000, undefined, {
          signal: abortController.signal,
        }).catch(() => undefined);
      }
    }
  } finally {
    await Promise.allSettled([redisService.disconnect(), disconnectDB()]);
    if (shutdownDeadline) clearTimeout(shutdownDeadline);
    logger.info("Operational worker stopped", { workerId });
  }
};

main().catch(async (error: unknown) => {
  logger.error("Operational worker failed", error, {
    workerId,
    kind: requestedKind,
  });
  await Promise.allSettled([redisService.disconnect(), disconnectDB()]);
  process.exitCode = 1;
});
