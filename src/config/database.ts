import mongoose from "mongoose";

import { config } from "./env.js";
import { logger } from "../utils/logger.js";

export const connectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState === mongoose.ConnectionStates.connected) return;

  await mongoose.connect(config.MONGO_URI, {
    autoIndex: config.NODE_ENV !== "production",
    autoCreate: config.NODE_ENV !== "production",
    maxPoolSize: 20,
    minPoolSize: config.NODE_ENV === "production" ? 2 : 0,
    serverSelectionTimeoutMS: 5_000,
    // Supports standalone/local MongoDB and Mongo-compatible deployments that
    // reject retryable writes. Domain-level idempotency still protects booking
    // and payment commands.
    retryWrites: false,
  });

  if (config.NODE_ENV === "production") {
    const hello = (await mongoose.connection.db?.admin().command({
      hello: 1,
    })) as { setName?: string; msg?: string } | undefined;
    if (!hello?.setName && hello?.msg !== "isdbgrid") {
      await mongoose.disconnect();
      throw new Error(
        "Production MongoDB must be a replica set or sharded cluster because transactional booking writes are required",
      );
    }
  }

  logger.info("MongoDB connection established");
};

export const disconnectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState === mongoose.ConnectionStates.disconnected) return;

  await mongoose.disconnect();
  logger.info("MongoDB connection closed");
};

export const isDBReady = (): boolean =>
  mongoose.connection.readyState === mongoose.ConnectionStates.connected;
