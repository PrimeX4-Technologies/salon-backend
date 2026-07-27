import type { RequestHandler } from "express";

import { ApiError } from "../../utils/ApiError.js";

const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const assertSafeObject = (value: unknown, path: string): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeObject(item, `${path}.${index}`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.startsWith("$") || key.includes(".") || UNSAFE_KEYS.has(key)) {
      throw ApiError.badRequest(
        "Request contains an unsafe object key",
        { path: `${path}.${key}` },
        "UNSAFE_REQUEST_KEY",
      );
    }
    assertSafeObject(child, `${path}.${key}`);
  }
};

export const rejectUnsafeKeys: RequestHandler = (req, _res, next) => {
  try {
    // Signed webhooks are authenticated against the exact, size-limited raw
    // bytes. Their provider-defined JSON keys must not be rewritten or
    // rejected before the registered adapter verifies the signature.
    if (!req.rawBody) assertSafeObject(req.body, "body");
    assertSafeObject(req.query, "query");
    assertSafeObject(req.params, "params");
    next();
  } catch (error) {
    next(error);
  }
};
