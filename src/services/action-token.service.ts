import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import { config } from "../config/env.js";
import { redisService } from "./redis.service.js";
import { ApiError } from "../utils/ApiError.js";

export type ActionTokenPurpose = "password-reset" | "email-verification";

export interface ActionTokenRecord {
  purpose: ActionTokenPurpose;
  userId: string;
  tokenVersion: number;
  subject?: string;
  createdAt: string;
  expiresAt: string;
}

export interface IssuedActionToken {
  rawToken: string;
  encryptedToken: string;
  expiresAt: string;
}

const encryptionKey = createHash("sha256")
  .update(config.AUTH_ACTION_TOKEN_SECRET)
  .digest();

const digestToken = (purpose: ActionTokenPurpose, rawToken: string): string =>
  createHmac("sha256", config.AUTH_ACTION_TOKEN_SECRET)
    .update(`${purpose}:${rawToken}`)
    .digest("base64url");

const tokenKey = (purpose: ActionTokenPurpose, digest: string): string =>
  `auth:action:${purpose}:${digest}`;

const userPointerKey = (purpose: ActionTokenPurpose, userId: string): string =>
  `auth:action-user:${purpose}:${userId}`;

export const encryptActionToken = (
  purpose: ActionTokenPurpose,
  rawToken: string,
): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAAD(Buffer.from(purpose));
  const encrypted = Buffer.concat([
    cipher.update(rawToken, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
};

export const decryptActionToken = (
  purpose: ActionTokenPurpose,
  encryptedToken: string,
): string => {
  const [version, encodedIv, encodedTag, encodedPayload] =
    encryptedToken.split(".");
  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedTag ||
    !encodedPayload
  ) {
    throw new Error("Unsupported encrypted action-token payload");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey,
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedPayload, "base64url")),
    decipher.final(),
  ]).toString("utf8");
};

export class ActionTokenService {
  async issue(
    purpose: ActionTokenPurpose,
    record: Omit<ActionTokenRecord, "purpose" | "createdAt" | "expiresAt">,
    ttlSeconds: number,
  ): Promise<IssuedActionToken> {
    const rawToken = randomBytes(32).toString("base64url");
    const digest = digestToken(purpose, rawToken);
    const pointerKey = userPointerKey(purpose, record.userId);
    const previousDigest = await redisService.get<string>(pointerKey);
    if (previousDigest) {
      await redisService.delete(tokenKey(purpose, previousDigest));
    }

    const now = Date.now();
    const expiresAt = new Date(now + ttlSeconds * 1000).toISOString();
    await Promise.all([
      redisService.set<ActionTokenRecord>(
        tokenKey(purpose, digest),
        {
          ...record,
          purpose,
          createdAt: new Date(now).toISOString(),
          expiresAt,
        },
        ttlSeconds,
      ),
      redisService.set(pointerKey, digest, ttlSeconds),
    ]);

    return {
      rawToken,
      encryptedToken: encryptActionToken(purpose, rawToken),
      expiresAt,
    };
  }

  async consume(
    purpose: ActionTokenPurpose,
    rawToken: string,
  ): Promise<ActionTokenRecord> {
    const digest = digestToken(purpose, rawToken);
    const record =
      await redisService.getAndDeletePointedValue<ActionTokenRecord>(
        userPointerKey(purpose, await this.getTokenUserId(purpose, digest)),
        digest,
      tokenKey(purpose, digest),
    );
    if (!record || record.purpose !== purpose) {
      throw ApiError.badRequest(
        "Action token is invalid or expired",
        undefined,
        "INVALID_ACTION_TOKEN",
      );
    }

    return record;
  }

  async revokeIssuedToken(
    purpose: ActionTokenPurpose,
    userId: string,
    rawToken: string,
  ): Promise<void> {
    const digest = digestToken(purpose, rawToken);
    await redisService.getAndDeletePointedValue<ActionTokenRecord>(
      userPointerKey(purpose, userId),
      digest,
      tokenKey(purpose, digest),
    );
  }

  private async getTokenUserId(
    purpose: ActionTokenPurpose,
    digest: string,
  ): Promise<string> {
    const record = await redisService.get<ActionTokenRecord>(
      tokenKey(purpose, digest),
    );
    return record?.userId ?? "invalid";
  }
}

export const actionTokenService = new ActionTokenService();
