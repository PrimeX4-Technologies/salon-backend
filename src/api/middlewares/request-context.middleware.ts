import { randomUUID } from "node:crypto";

import type { RequestHandler } from "express";

import { logger } from "../../utils/logger.js";

export const requestContext: RequestHandler = (req, res, next) => {
  const incomingRequestId = req.header("x-request-id")?.trim();
  const requestId =
    incomingRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(incomingRequestId)
      ? incomingRequestId
      : randomUUID();
  const startedAt = process.hrtime.bigint();

  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info("HTTP request completed", {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      userId: req.auth?.userId,
    });
  });

  next();
};
