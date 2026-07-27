export interface ApiErrorOptions {
  code?: string;
  details?: unknown;
  cause?: unknown;
  expose?: boolean;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly expose: boolean;
  readonly isOperational = true;

  constructor(
    statusCode: number,
    message: string,
    options: ApiErrorOptions | string = {},
  ) {
    const normalizedOptions = typeof options === "string" ? { code: options } : options;
    super(message, { cause: normalizedOptions.cause });
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = normalizedOptions.code ?? "API_ERROR";
    this.details = normalizedOptions.details;
    this.expose = normalizedOptions.expose ?? statusCode < 500;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(
    message = "Bad request",
    detailsOrCode?: unknown,
    code = "BAD_REQUEST",
  ): ApiError {
    const details = typeof detailsOrCode === "string" ? undefined : detailsOrCode;
    const normalizedCode =
      typeof detailsOrCode === "string" ? detailsOrCode : code;
    return new ApiError(400, message, { code: normalizedCode, details });
  }

  static unauthorized(message = "Authentication required", code = "UNAUTHORIZED"): ApiError {
    return new ApiError(401, message, { code });
  }

  static forbidden(message = "You do not have permission", code = "FORBIDDEN"): ApiError {
    return new ApiError(403, message, { code });
  }

  static notFound(message = "Resource not found", code = "NOT_FOUND"): ApiError {
    return new ApiError(404, message, { code });
  }

  static conflict(
    message = "Resource conflict",
    detailsOrCode?: unknown,
    code = "CONFLICT",
  ): ApiError {
    const details = typeof detailsOrCode === "string" ? undefined : detailsOrCode;
    const normalizedCode =
      typeof detailsOrCode === "string" ? detailsOrCode : code;
    return new ApiError(409, message, { code: normalizedCode, details });
  }

  static tooManyRequests(message = "Too many requests", code = "RATE_LIMITED"): ApiError {
    return new ApiError(429, message, { code });
  }
}
