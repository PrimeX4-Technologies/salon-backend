import mongoose from "mongoose";

import { connectDB, disconnectDB } from "../config/database.js";
import "../models/index.js";
import { logger } from "../utils/logger.js";

const main = async (): Promise<void> => {
  await connectDB();

  const modelNames = mongoose.modelNames().sort();
  for (const modelName of modelNames) {
    await mongoose.model(modelName).createIndexes();
    logger.info("MongoDB indexes ensured", { model: modelName });
  }

  logger.info("MongoDB index creation completed", {
    modelCount: modelNames.length,
  });
};

try {
  await main();
  await disconnectDB();
  process.exitCode = 0;
} catch (error) {
  logger.error("MongoDB index creation failed", error);
  await disconnectDB().catch(() => undefined);
  process.exitCode = 1;
}
