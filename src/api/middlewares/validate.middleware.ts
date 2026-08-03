import type { RequestHandler } from "express";
import type { ZodType } from "zod";

import { ApiError } from "../../utils/ApiError.js";

export interface RequestValidationSchema {
  body?: ZodType;
  params?: ZodType;
  query?: ZodType;
}

const parsePart = (schema: ZodType | undefined, value: unknown, part: string): unknown => {
  if (!schema) return value;
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  throw ApiError.badRequest(
    "Request validation failed",
    result.error.issues.map((issue) => ({
      path: [part, ...issue.path.map(String)].join("."),
      message: issue.message,
      code: issue.code,
    })),
    "VALIDATION_ERROR",
  );
};

export const validate = (schemas: RequestValidationSchema): RequestHandler =>
  (req, _res, next): void => {
    try {
      req.body = parsePart(schemas.body, req.body, "body");

      const parsedParams = parsePart(schemas.params, req.params, "params");
      if (parsedParams && typeof parsedParams === "object") {
        Object.assign(req.params, parsedParams);
      }

      const parsedQuery = parsePart(schemas.query, req.query, "query");
      if (parsedQuery && typeof parsedQuery === "object") {
        // Express 5 exposes `req.query` through a prototype getter. Defining an
        // own value ensures downstream handlers receive Zod's coerced/defaulted
        // data instead of reparsing the original query string.
        Object.defineProperty(req, "query", {
          configurable: true,
          enumerable: true,
          value: parsedQuery,
          writable: false,
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
