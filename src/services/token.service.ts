import { createHash, randomUUID } from "node:crypto";

import jwt, { type JwtPayload } from "jsonwebtoken";

import { config } from "../config/env.js";
import type { UserDocument, UserRole } from "../models/auth/User.js";
import { redisService } from "./redis.service.js";
import { ApiError } from "../utils/ApiError.js";
import type { AuthSessionSummary, AuthTokens } from "../types/auth.js";

const AUTH_SESSION_PREFIX = "auth:session:";
const AUTH_USER_SESSIONS_PREFIX = "auth:user-sessions:";
const AUTH_FAMILY_PREFIX = "auth:refresh-family:";

interface AccessClaims extends JwtPayload {
  type: "access";
  role: UserRole;
  tokenVersion: number;
}

interface RefreshClaims extends JwtPayload {
  type: "refresh";
  familyId: string;
  tokenVersion: number;
}

export interface AuthSession {
  userId: string;
  role: UserRole;
  tokenVersion: number;
  familyId: string;
  createdAt: string;
  expiresAt: string;
  ipHash?: string;
  userAgent?: string;
}

interface RefreshFamily {
  userId: string;
  tokenVersion: number;
  currentSessionId: string;
}

export interface SessionContext {
  ip?: string;
  userAgent?: string;
}

export interface VerifiedAccessToken {
  userId: string;
  role: UserRole;
  sessionId: string;
  tokenVersion: number;
}

export interface ConsumedRefreshToken {
  userId: string;
  sessionId: string;
  familyId: string;
  tokenVersion: number;
  session: AuthSession;
}

const hash = (value: string): string =>
  createHash("sha256").update(value).digest("base64url");

const sessionKey = (sessionId: string): string =>
  `${AUTH_SESSION_PREFIX}${hash(sessionId)}`;

const userSessionsKey = (userId: string): string =>
  `${AUTH_USER_SESSIONS_PREFIX}${userId}`;

const familyKey = (familyId: string): string =>
  `${AUTH_FAMILY_PREFIX}${hash(familyId)}`;

const isUserRole = (value: unknown): value is UserRole =>
  value === "admin" || value === "employee" || value === "customer";

const assertCommonClaims = (
  decoded: string | JwtPayload,
  expectedType: "access" | "refresh",
): JwtPayload => {
  if (
    typeof decoded === "string" ||
    decoded.type !== expectedType ||
    typeof decoded.sub !== "string" ||
    typeof decoded.jti !== "string" ||
    !Number.isSafeInteger(decoded.tokenVersion) ||
    (decoded.tokenVersion as number) < 0
  ) {
    throw ApiError.unauthorized("Authentication token is invalid", "INVALID_TOKEN");
  }
  return decoded;
};

export class TokenService {
  verifyAccessToken(token: string): VerifiedAccessToken {
    try {
      const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, {
        algorithms: ["HS256"],
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      });
      const claims = assertCommonClaims(decoded, "access") as AccessClaims;
      if (!isUserRole(claims.role)) {
        throw ApiError.unauthorized("Authentication token is invalid", "INVALID_TOKEN");
      }

      return {
        userId: claims.sub as string,
        sessionId: claims.jti as string,
        role: claims.role,
        tokenVersion: claims.tokenVersion,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof jwt.TokenExpiredError) {
        throw ApiError.unauthorized("Access token has expired", "ACCESS_TOKEN_EXPIRED");
      }
      throw new ApiError(401, "Access token is invalid", {
        code: "INVALID_ACCESS_TOKEN",
        cause: error,
      });
    }
  }

  private verifyRefreshToken(token: string): RefreshClaims {
    try {
      const decoded = jwt.verify(token, config.JWT_REFRESH_SECRET, {
        algorithms: ["HS256"],
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
      });
      const claims = assertCommonClaims(decoded, "refresh") as RefreshClaims;
      if (typeof claims.familyId !== "string" || claims.familyId.length < 16) {
        throw ApiError.unauthorized("Refresh token is invalid", "INVALID_REFRESH_TOKEN");
      }
      return claims;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof jwt.TokenExpiredError) {
        throw ApiError.unauthorized("Refresh token has expired", "REFRESH_TOKEN_EXPIRED");
      }
      throw new ApiError(401, "Refresh token is invalid", {
        code: "INVALID_REFRESH_TOKEN",
        cause: error,
      });
    }
  }

  async issue(
    user: Pick<UserDocument, "id" | "role" | "tokenVersion">,
    context: SessionContext = {},
    familyId: string = randomUUID(),
  ): Promise<AuthTokens> {
    const sessionId = randomUUID();
    const now = Date.now();
    const session: AuthSession = {
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
      familyId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + config.JWT_REFRESH_TTL_SECONDS * 1000).toISOString(),
      ...(context.ip ? { ipHash: hash(context.ip) } : {}),
      ...(context.userAgent
        ? { userAgent: context.userAgent.trim().slice(0, 512) }
        : {}),
    };

    const accessToken = jwt.sign(
      {
        type: "access",
        role: user.role,
        tokenVersion: user.tokenVersion,
      },
      config.JWT_ACCESS_SECRET,
      {
        algorithm: "HS256",
        subject: user.id,
        jwtid: sessionId,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        expiresIn: config.JWT_ACCESS_TTL_SECONDS,
      },
    );
    const refreshToken = jwt.sign(
      {
        type: "refresh",
        familyId,
        tokenVersion: user.tokenVersion,
      },
      config.JWT_REFRESH_SECRET,
      {
        algorithm: "HS256",
        subject: user.id,
        jwtid: sessionId,
        issuer: config.JWT_ISSUER,
        audience: config.JWT_AUDIENCE,
        expiresIn: config.JWT_REFRESH_TTL_SECONDS,
      },
    );

    await redisService.set(
      sessionKey(sessionId),
      session,
      config.JWT_REFRESH_TTL_SECONDS,
    );
    await Promise.all([
      redisService.set<RefreshFamily>(
        familyKey(familyId),
        {
          userId: user.id,
          tokenVersion: user.tokenVersion,
          currentSessionId: sessionId,
        },
        config.JWT_REFRESH_TTL_SECONDS,
      ),
      redisService.addToSortedSet(
        userSessionsKey(user.id),
        sessionId,
        now + config.JWT_REFRESH_TTL_SECONDS * 1000,
        config.JWT_REFRESH_TTL_SECONDS,
      ),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      accessExpiresIn: config.JWT_ACCESS_TTL_SECONDS,
      refreshExpiresIn: config.JWT_REFRESH_TTL_SECONDS,
    };
  }

  async getActiveSession(sessionId: string): Promise<AuthSession | null> {
    return redisService.get<AuthSession>(sessionKey(sessionId));
  }

  async consumeRefreshToken(token: string): Promise<ConsumedRefreshToken> {
    const claims = this.verifyRefreshToken(token);
    const family = await redisService.get<RefreshFamily>(
      familyKey(claims.familyId),
    );
    const session = await redisService.getAndDelete<AuthSession>(
      sessionKey(claims.jti as string),
    );

    if (
      family &&
      family.userId === claims.sub &&
      family.tokenVersion === claims.tokenVersion &&
      family.currentSessionId !== claims.jti
    ) {
      await this.revokeFamily(family, claims.familyId);
      throw new RefreshTokenReuseError(claims.sub);
    }

    if (
      !session ||
      session.userId !== claims.sub ||
      session.familyId !== claims.familyId ||
      session.tokenVersion !== claims.tokenVersion
    ) {
      throw ApiError.unauthorized(
        "Refresh session is no longer active",
        "REFRESH_SESSION_REVOKED",
      );
    }

    await redisService.removeFromSortedSet(
      userSessionsKey(session.userId),
      claims.jti as string,
    );

    return {
      userId: claims.sub,
      sessionId: claims.jti as string,
      familyId: claims.familyId,
      tokenVersion: claims.tokenVersion,
      session,
    };
  }

  async revokeSession(sessionId: string): Promise<void> {
    const session = await redisService.get<AuthSession>(sessionKey(sessionId));
    await redisService.delete(sessionKey(sessionId));
    if (!session) return;

    await redisService.removeFromSortedSet(
      userSessionsKey(session.userId),
      sessionId,
    );
    const family = await redisService.get<RefreshFamily>(
      familyKey(session.familyId),
    );
    if (family?.currentSessionId === sessionId) {
      await redisService.delete(familyKey(session.familyId));
    }
  }

  async listUserSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<AuthSessionSummary[]> {
    const indexKey = userSessionsKey(userId);
    await redisService.removeSortedSetByScore(indexKey, 0, Date.now());
    const ids = await redisService.getSortedSetByScore(
      indexKey,
      Date.now(),
      Number.MAX_SAFE_INTEGER,
    );
    const sessions = await Promise.all(
      ids.map(async (id) => ({
        id,
        session: await this.getActiveSession(id),
      })),
    );

    return sessions
      .filter(
        (entry): entry is { id: string; session: AuthSession } =>
          Boolean(entry.session && entry.session.userId === userId),
      )
      .map(({ id, session }) => ({
        id,
        current: id === currentSessionId,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        ...(session.userAgent ? { userAgent: session.userAgent } : {}),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revokeUserSession(userId: string, sessionId: string): Promise<boolean> {
    const session = await this.getActiveSession(sessionId);
    if (!session || session.userId !== userId) return false;
    await this.revokeSession(sessionId);
    return true;
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    const indexKey = userSessionsKey(userId);
    const ids = await redisService.getSortedSetByScore(
      indexKey,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const sessions = await Promise.all(
      ids.map((id) => this.getActiveSession(id)),
    );
    const families = sessions
      .filter((session): session is AuthSession => session !== null)
      .map((session) => familyKey(session.familyId));

    await redisService.deleteMany([
      ...ids.map(sessionKey),
      ...families,
      indexKey,
    ]);
  }

  private async revokeFamily(
    family: RefreshFamily,
    id: string,
  ): Promise<void> {
    await Promise.all([
      this.revokeSession(family.currentSessionId),
      redisService.delete(familyKey(id)),
    ]);
  }
}

export class RefreshTokenReuseError extends ApiError {
  constructor(readonly userId: string) {
    super(401, "Refresh-token reuse was detected; all sessions were revoked", {
      code: "REFRESH_TOKEN_REUSE_DETECTED",
    });
  }
}

export const tokenService = new TokenService();
