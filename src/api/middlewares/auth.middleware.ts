import type { RequestHandler } from "express";

import User from "../../models/auth/User.js";
import { tokenService } from "../../services/token.service.js";
import { ApiError } from "../../utils/ApiError.js";
import { catchAsync } from "../../utils/catchAsync.js";

const getBearerToken = (authorization: string | undefined): string | null => {
  if (!authorization) return null;

  const [scheme, token, ...extra] = authorization.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || extra.length > 0) {
    throw ApiError.unauthorized(
      "Authorization header must use Bearer authentication",
      "INVALID_AUTHORIZATION_HEADER",
    );
  }
  return token;
};

const authenticateRequest = async (
  authorization: string | undefined,
): Promise<{
  auth: NonNullable<Express.Request["auth"]>;
  user: NonNullable<Express.Request["user"]>;
}> => {
  const token = getBearerToken(authorization);
  if (!token) {
    throw ApiError.unauthorized("Authentication is required", "AUTHENTICATION_REQUIRED");
  }

  const claims = tokenService.verifyAccessToken(token);
  const session = await tokenService.getActiveSession(claims.sessionId);
  if (
    !session ||
    session.userId !== claims.userId ||
    session.role !== claims.role ||
    session.tokenVersion !== claims.tokenVersion
  ) {
    throw ApiError.unauthorized(
      "Authentication session is no longer active",
      "SESSION_REVOKED",
    );
  }

  const user = await User.findById(claims.userId).select("+tokenVersion");
  if (
    !user ||
    !user.isActive ||
    user.role !== claims.role ||
    user.tokenVersion !== claims.tokenVersion
  ) {
    throw ApiError.unauthorized(
      "Authentication session is no longer valid",
      "SESSION_REVOKED",
    );
  }

  return {
    auth: {
      userId: claims.userId,
      role: claims.role,
      sessionId: claims.sessionId,
      tokenVersion: claims.tokenVersion,
    },
    user,
  };
};

export const authenticate: RequestHandler = catchAsync(async (req, res, next) => {
  const authenticated = await authenticateRequest(req.get("authorization"));
  req.auth = authenticated.auth;
  req.user = authenticated.user;
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

export const optionalAuthenticate: RequestHandler = catchAsync(
  async (req, _res, next) => {
    if (!req.get("authorization")) {
      next();
      return;
    }

    const authenticated = await authenticateRequest(req.get("authorization"));
    req.auth = authenticated.auth;
    req.user = authenticated.user;
    next();
  },
);
