import type { ErrorRequestHandler, RequestHandler } from "express";

import { config } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: { message: "Route not found" },
  });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  logger.error("Unhandled request error", error, {
    method: req.method,
    path: req.originalUrl,
  });

  if (res.headersSent) {
    next(error);
    return;
  }

  res.status(500).json({
    success: false,
    error: {
      message: "Internal server error",
      ...(config.NODE_ENV === "development" && error instanceof Error
        ? { details: error.message }
        : {}),
    },
  });
};
