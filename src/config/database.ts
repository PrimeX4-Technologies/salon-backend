import mongoose from "mongoose";

import { config } from "./env.js";
import { logger } from "../utils/logger.js";

export const connectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState === 1) return;

  await mongoose.connect(config.MONGO_URI, {
    maxPoolSize: 20,
    minPoolSize: config.NODE_ENV === "production" ? 2 : 0,
    serverSelectionTimeoutMS: 5_000,
  });

  logger.info("MongoDB connection established");
};

export const disconnectDB = async (): Promise<void> => {
  if (mongoose.connection.readyState === 0) return;

  await mongoose.disconnect();
  logger.info("MongoDB connection closed");
};

export const isDBReady = (): boolean => mongoose.connection.readyState === 1;
