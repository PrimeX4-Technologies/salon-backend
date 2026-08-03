import type { Response } from "express";

import type { PaginationMeta } from "./pagination.js";

export const sendSuccess = <T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>,
): void => {
  res.status(statusCode).json({
    success: true,
    data,
    ...(meta ? { meta } : {}),
  });
};

export const sendCreated = <T>(res: Response, data: T): void =>
  sendSuccess(res, data, 201);

export const sendPaginated = <T>(
  res: Response,
  data: T[],
  pagination: PaginationMeta,
): void => sendSuccess(res, data, 200, { pagination });

export const sendNoContent = (res: Response): void => {
  res.status(204).send();
};
