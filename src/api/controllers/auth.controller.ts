import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import type { CookieOptions, Request, Response } from "express";

import { config } from "../../config/env.js";
import { authService } from "../../services/auth.service.js";
import type { AuthResult } from "../../types/auth.js";
import type {
  ChangePasswordInput,
  ConfirmEmailInput,
  CustomerRegistrationInput,
  ForgotPasswordInput,
  GoogleLoginInput,
  LoginInput,
  ResetPasswordInput,
} from "../../validation/auth.schemas.js";
import { ApiError } from "../../utils/ApiError.js";
import { catchAsync } from "../../utils/catchAsync.js";

const authCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: config.AUTH_COOKIE_SECURE,
  sameSite: config.AUTH_COOKIE_SAME_SITE,
  path: "/api/v1/auth",
  maxAge: config.JWT_REFRESH_TTL_SECONDS * 1000,
};

const csrfCookieOptions: CookieOptions = {
  ...authCookieOptions,
  httpOnly: false,
};

const getSessionContext = (request: Request) => ({
  ...(request.ip ? { ip: request.ip } : {}),
  ...(request.get("user-agent")
    ? { userAgent: request.get("user-agent") as string }
    : {}),
});

const makeCsrfToken = (refreshToken: string): string => {
  const nonce = randomBytes(32).toString("base64url");
  const signature = createHmac("sha256", config.AUTH_ACTION_TOKEN_SECRET)
    .update(`${refreshToken}.${nonce}`)
    .digest("base64url");
  return `${nonce}.${signature}`;
};

const setSessionCookies = (
  response: Response,
  refreshToken: string,
): string => {
  const csrfToken = makeCsrfToken(refreshToken);
  response.cookie(
    config.AUTH_REFRESH_COOKIE_NAME,
    refreshToken,
    authCookieOptions,
  );
  response.cookie(config.AUTH_CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions);
  return csrfToken;
};

const clearSessionCookies = (response: Response): void => {
  const clearOptions: CookieOptions = {
    secure: authCookieOptions.secure,
    sameSite: authCookieOptions.sameSite,
    path: authCookieOptions.path,
  };
  response.clearCookie(config.AUTH_REFRESH_COOKIE_NAME, {
    ...clearOptions,
    httpOnly: true,
  });
  response.clearCookie(config.AUTH_CSRF_COOKIE_NAME, {
    ...clearOptions,
    httpOnly: false,
  });
};

const stringsEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const isValidCsrfToken = (
  refreshToken: string,
  csrfToken: string,
): boolean => {
  const [nonce, receivedSignature, ...extra] = csrfToken.split(".");
  if (!nonce || !receivedSignature || extra.length > 0) return false;
  const expectedSignature = createHmac(
    "sha256",
    config.AUTH_ACTION_TOKEN_SECRET,
  )
    .update(`${refreshToken}.${nonce}`)
    .digest("base64url");
  return stringsEqual(receivedSignature, expectedSignature);
};

const getRefreshToken = (request: Request): string => {
  const bodyToken =
    request.body &&
    typeof request.body === "object" &&
    typeof (request.body as { refreshToken?: unknown }).refreshToken === "string"
      ? (request.body as { refreshToken: string }).refreshToken
      : undefined;
  if (bodyToken) return bodyToken;

  const cookies = request.cookies as Record<string, unknown> | undefined;
  const cookieTokenCandidate = cookies?.[config.AUTH_REFRESH_COOKIE_NAME];
  const cookieToken =
    typeof cookieTokenCandidate === "string"
      ? cookieTokenCandidate
      : undefined;
  if (!cookieToken) {
    throw ApiError.unauthorized(
      "A refresh token is required",
      "REFRESH_TOKEN_REQUIRED",
    );
  }

  const csrfHeader = request.get("x-csrf-token");
  const csrfCookieCandidate = cookies?.[config.AUTH_CSRF_COOKIE_NAME];
  const csrfCookie =
    typeof csrfCookieCandidate === "string"
      ? csrfCookieCandidate
      : undefined;
  if (
    !csrfHeader ||
    !csrfCookie ||
    !stringsEqual(csrfHeader, csrfCookie) ||
    !isValidCsrfToken(cookieToken, csrfCookie)
  ) {
    throw ApiError.forbidden(
      "CSRF validation failed",
      "CSRF_TOKEN_INVALID",
    );
  }
  return cookieToken;
};

const sendAuthResult = (
  response: Response,
  statusCode: number,
  result: AuthResult,
): void => {
  const csrfToken = setSessionCookies(response, result.tokens.refreshToken);
  response.status(statusCode).json({
    success: true,
    data: {
      user: result.user,
      authentication: {
        accessToken: result.tokens.accessToken,
        tokenType: result.tokens.tokenType,
        expiresIn: result.tokens.accessExpiresIn,
        refreshExpiresIn: result.tokens.refreshExpiresIn,
        csrfToken,
        ...(config.AUTH_RETURN_REFRESH_TOKEN
          ? { refreshToken: result.tokens.refreshToken }
          : {}),
      },
    },
  });
};

const requireAuth = (request: Request) => {
  if (!request.auth) {
    throw ApiError.unauthorized(
      "Authentication is required",
      "AUTHENTICATION_REQUIRED",
    );
  }
  return request.auth;
};

export const registerCustomer = catchAsync(async (req, res) => {
  const result = await authService.registerCustomer(
    req.body as CustomerRegistrationInput,
    getSessionContext(req),
  );
  sendAuthResult(res, 201, result);
});

export const login = catchAsync(async (req, res) => {
  const result = await authService.login(
    req.body as LoginInput,
    getSessionContext(req),
  );
  sendAuthResult(res, 200, result);
});

export const googleLogin = catchAsync(async (req, res) => {
  const result = await authService.loginWithGoogle(
    req.body as GoogleLoginInput,
    getSessionContext(req),
  );
  sendAuthResult(res, 200, result);
});

export const refresh = catchAsync(async (req, res) => {
  const result = await authService.refresh(
    getRefreshToken(req),
    getSessionContext(req),
  );
  sendAuthResult(res, 200, result);
});

export const logout = catchAsync(async (req, res) => {
  const auth = requireAuth(req);
  await authService.logout(auth.sessionId);
  clearSessionCookies(res);
  res.status(204).send();
});

export const logoutAll = catchAsync(async (req, res) => {
  const auth = requireAuth(req);
  await authService.logoutAll(auth.userId);
  clearSessionCookies(res);
  res.status(204).send();
});

export const changePassword = catchAsync(async (req, res) => {
  const auth = requireAuth(req);
  const result = await authService.changePassword(
    auth.userId,
    req.body as ChangePasswordInput,
    getSessionContext(req),
  );
  sendAuthResult(res, 200, result);
});

export const getMe = catchAsync(async (req, res) => {
  const auth = requireAuth(req);
  const user = await authService.getMe(auth.userId);
  res.status(200).json({ success: true, data: { user } });
});

export const forgotPassword = catchAsync(async (req, res) => {
  const development = await authService.requestPasswordReset(
    req.body as ForgotPasswordInput,
  );
  res.status(202).json({
    success: true,
    data: {
      message:
        "If an eligible account exists, password-reset instructions have been queued.",
      ...development,
    },
  });
});

export const resetPassword = catchAsync(async (req, res) => {
  await authService.resetPassword(req.body as ResetPasswordInput);
  clearSessionCookies(res);
  res.status(204).send();
});

export const requestEmailVerification = catchAsync(async (req, res) => {
  const auth = requireAuth(req);
  const result = await authService.requestEmailVerification(auth.userId);
  res.status(202).json({
    success: true,
    data: {
      message: result.alreadyVerified
        ? "Email address is already verified."
        : "Email-verification instructions have been queued.",
      ...result,
    },
  });
});

export const confirmEmail = catchAsync(async (req, res) => {
  const user = await authService.confirmEmail(req.body as ConfirmEmailInput);
  res.status(200).json({ success: true, data: { user } });
});

export const listSessions = catchAsync(async (req, res) => {
  const auth = requireAuth(req);
  const sessions = await authService.listSessions(
    auth.userId,
    auth.sessionId,
  );
  res.status(200).json({ success: true, data: { sessions } });
});

export const revokeSession = catchAsync(async (req, res) => {
  const auth = requireAuth(req);
  const sessionId = String(req.params.sessionId);
  const revoked = await authService.revokeSession(auth.userId, sessionId);
  if (!revoked) {
    throw ApiError.notFound("Authentication session was not found", "SESSION_NOT_FOUND");
  }
  if (sessionId === auth.sessionId) clearSessionCookies(res);
  res.status(204).send();
});
