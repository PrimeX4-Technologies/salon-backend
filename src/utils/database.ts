import mongoose, { type ClientSession, type Model } from "mongoose";

import { config } from "../config/env.js";
import { ApiError } from "./ApiError.js";
import { logger } from "./logger.js";

let transactionsUnavailable = false;
let fallbackWarningLogged = false;

const transactionIsUnsupported = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: number;
    codeName?: string;
    message?: string;
  };
  return (
    candidate.code === 20 ||
    candidate.codeName === "IllegalOperation" ||
    candidate.message?.includes(
      "Transaction numbers are only allowed on a replica set member",
    ) === true
  );
};

const runWithoutTransaction = async <T>(
  operation: (session: ClientSession) => Promise<T>,
): Promise<T> => {
  const session = await mongoose.startSession();
  try {
    if (!fallbackWarningLogged) {
      fallbackWarningLogged = true;
      logger.warn(
        "MongoDB transactions are unavailable; using non-atomic development fallback",
      );
    }
    return await operation(session);
  } finally {
    await session.endSession();
  }
};

export const withTransaction = async <T>(
  operation: (session: ClientSession) => Promise<T>,
): Promise<T> => {
  if (transactionsUnavailable && config.NODE_ENV !== "production") {
    return runWithoutTransaction(operation);
  }

  try {
    return await mongoose.connection.transaction(operation, {
      readPreference: "primary",
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
    });
  } catch (error) {
    if (config.NODE_ENV === "production" || !transactionIsUnsupported(error)) {
      throw error;
    }
    transactionsUnavailable = true;
    return runWithoutTransaction(operation);
  }
};

export const findByIdOrThrow = async <T>(
  model: Model<T>,
  id: string,
  resourceName: string,
  session?: ClientSession,
): Promise<mongoose.HydratedDocument<T>> => {
  const document = await model.findById(id).session(session ?? null);
  if (!document) throw ApiError.notFound(`${resourceName} was not found`);
  return document;
};
