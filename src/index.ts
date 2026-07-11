import { createServer, type Server } from "node:http";

import app from "./app.js";
import { connectDB, disconnectDB } from "./config/database.js";
import { config } from "./config/env.js";
import { redisService } from "./services/redis.service.js";
import { logger } from "./utils/logger.js";

let server: Server | undefined;
let shuttingDown = false;

const closeHttpServer = async (): Promise<void> => {
  if (!server?.listening) return;

  await new Promise<void>((resolve, reject) => {
    server?.close((error) => (error ? reject(error) : resolve()));
    server?.closeIdleConnections();
  });
};

const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Graceful shutdown started", { reason });

  const timeout = setTimeout(() => {
    logger.error("Graceful shutdown timed out");
    server?.closeAllConnections();
    process.exit(1);
  }, config.SHUTDOWN_TIMEOUT_MS);
  timeout.unref();

  try {
    await closeHttpServer();
    await Promise.allSettled([redisService.disconnect(), disconnectDB()]);
    clearTimeout(timeout);
    logger.info("Graceful shutdown completed");
    process.exit(exitCode);
  } catch (error) {
    clearTimeout(timeout);
    logger.error("Graceful shutdown failed", error);
    process.exit(1);
  }
};

const start = async (): Promise<void> => {
  try {
    const connectionResults = await Promise.allSettled([connectDB(), redisService.connect()]);
    const connectionErrors = connectionResults
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason);

    if (connectionErrors.length > 0) {
      throw new AggregateError(connectionErrors, "One or more infrastructure connections failed");
    }

    if (shuttingDown) return;

    server = createServer(app);
    server.requestTimeout = 30_000;
    server.headersTimeout = 31_000;
    server.keepAliveTimeout = 5_000;

    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(config.PORT, () => {
        server?.off("error", reject);
        resolve();
      });
    });

    logger.info("API server started", {
      environment: config.NODE_ENV,
      port: config.PORT,
    });
  } catch (error) {
    logger.error("Application startup failed", error);
    await Promise.allSettled([redisService.disconnect(), disconnectDB()]);
    process.exit(1);
  }
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("uncaughtException", (error) => {
  logger.error("Uncaught exception", error);
  void shutdown("uncaughtException", 1);
});
process.once("unhandledRejection", (error) => {
  logger.error("Unhandled promise rejection", error);
  void shutdown("unhandledRejection", 1);
});

void start();
