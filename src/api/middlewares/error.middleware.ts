import type { ErrorRequestHandler, RequestHandler } from "express";
import mongoose from "mongoose";

import { config } from "../../config/env.js";
import { ApiError } from "../../utils/ApiError.js";
import { logger } from "../../utils/logger.js";

interface MongoDuplicateError extends Error {
  code: number;
  keyValue?: Record<string, unknown>;
}

interface BodyParserError extends SyntaxError {
  status?: number;
  type?: string;
}

const bodyParserStatus = (error: unknown): number | undefined => {
  if (
    !(error instanceof Error) ||
    !("status" in error) ||
    typeof (error as BodyParserError).status !== "number"
  ) {
    return undefined;
  }
  return (error as BodyParserError).status;
};

const isMongoDuplicateError = (error: unknown): error is MongoDuplicateError =>
  error instanceof Error &&
  "code" in error &&
  (error as MongoDuplicateError).code === 11000;

const normalizeError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;

  if (error instanceof mongoose.Error.ValidationError) {
    return ApiError.badRequest(
      "Data validation failed",
      Object.values(error.errors).map((item) => ({
        path: item.path,
        message: item.message,
        kind: item.kind,
      })),
      "MODEL_VALIDATION_ERROR",
    );
  }

  if (error instanceof mongoose.Error.CastError) {
    return ApiError.badRequest(
      `Invalid value for ${error.path}`,
      { path: error.path },
      "INVALID_IDENTIFIER",
    );
  }

  if (error instanceof mongoose.Error.VersionError) {
    return ApiError.conflict(
      "The resource changed while it was being updated. Reload and try again.",
      undefined,
      "VERSION_CONFLICT",
    );
  }

  if (isMongoDuplicateError(error)) {
    return ApiError.conflict(
      "A resource with the same unique value already exists",
      { fields: Object.keys(error.keyValue ?? {}) },
      "DUPLICATE_RESOURCE",
    );
  }

  if (
    error instanceof SyntaxError &&
    bodyParserStatus(error) === 400
  ) {
    return ApiError.badRequest("Malformed JSON request body", undefined, "INVALID_JSON");
  }

  const parserStatus = bodyParserStatus(error);
  if (parserStatus === 400) {
    return ApiError.badRequest(
      "Request body could not be read",
      undefined,
      "INVALID_REQUEST_BODY",
    );
  }

  if (parserStatus === 413) {
    return new ApiError(413, "Request body is too large", {
      code: "REQUEST_BODY_TOO_LARGE",
    });
  }

  if (parserStatus === 415) {
    return new ApiError(415, "Request media type, charset, or encoding is unsupported", {
      code: "UNSUPPORTED_REQUEST_BODY",
    });
  }

  if (error instanceof URIError) {
    return ApiError.badRequest(
      "Request URL contains invalid encoding",
      undefined,
      "INVALID_URL_ENCODING",
    );
  }

  return new ApiError(500, "Internal server error", {
    code: "INTERNAL_ERROR",
    cause: error,
    expose: false,
  });
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(
    ApiError.notFound(
      `Route ${req.method} ${req.path} was not found`,
      "ROUTE_NOT_FOUND",
    ),
  );
};

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const normalized = normalizeError(error);
  const requestId = String(res.locals.requestId ?? res.getHeader("x-request-id") ?? "");
  const context = {
    requestId,
    method: req.method,
    path: req.path,
    statusCode: normalized.statusCode,
    code: normalized.code,
  };

  if (normalized.statusCode >= 500) {
    logger.error("HTTP request failed", error, context);
  } else {
    logger.warn("HTTP request rejected", {
      ...context,
      message: normalized.message,
    });
  }

  const message = normalized.expose ? normalized.message : "Internal server error";
  res.status(normalized.statusCode).json({
    success: false,
    error: {
      code: normalized.code,
      message,
      ...(normalized.expose && normalized.details !== undefined
        ? { details: normalized.details }
        : {}),
      ...(config.NODE_ENV === "development" && normalized.statusCode >= 500
        ? {
            debug:
              error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : String(error),
          }
        : {}),
      requestId,
    },
  });
};
