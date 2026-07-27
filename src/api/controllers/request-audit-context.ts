import type { Request, Response } from "express";

import type { AuditActorContext } from "../../services/audit.service.js";
import { ApiError } from "../../utils/ApiError.js";

export const getAuditContext = (
  req: Request,
  res: Response,
): AuditActorContext => ({
  actorUserId: req.auth?.userId,
  actorType: "user",
  requestId:
    typeof res.locals.requestId === "string"
      ? res.locals.requestId
      : undefined,
  ipAddress: req.ip,
  userAgent: req.get("user-agent"),
});

export const getValidatedParam = (
  req: Request,
  name: string,
): string => {
  const value = req.params[name];
  if (typeof value !== "string") {
    throw ApiError.badRequest(
      `A valid ${name} is required`,
      undefined,
      "INVALID_ROUTE_PARAMETER",
    );
  }
  return value;
};
