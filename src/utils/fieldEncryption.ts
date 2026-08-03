import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import { config } from "../config/env.js";
import { ApiError } from "./ApiError.js";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

const decodeKey = (): Buffer => {
  const configured = config.DATA_ENCRYPTION_KEY;
  if (!configured) {
    throw new ApiError(
      503,
      "Encrypted-data features are not configured",
      {
        code: "DATA_ENCRYPTION_NOT_CONFIGURED",
        expose: true,
      },
    );
  }

  return /^[0-9a-f]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64url");
};

export const assertDataEncryptionConfigured = (): void => {
  void decodeKey();
};

export const encryptSensitiveText = (
  plaintext: string,
  context: string,
): string => {
  const key = decodeKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(`${VERSION}:${context}`, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
};

export const decryptSensitiveText = (
  encrypted: string,
  context: string,
): string => {
  const [version, encodedIv, encodedTag, encodedCiphertext, ...extra] =
    encrypted.split(".");
  if (
    version !== VERSION ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    extra.length > 0
  ) {
    throw new ApiError(500, "Encrypted data has an unsupported format", {
      code: "INVALID_ENCRYPTED_DATA",
    });
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      decodeKey(),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAAD(Buffer.from(`${VERSION}:${context}`, "utf8"));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Encrypted data could not be authenticated", {
      code: "ENCRYPTED_DATA_AUTHENTICATION_FAILED",
      cause: error,
    });
  }
};

export const hashSensitiveValue = (value: string, context: string): string =>
  createHmac("sha256", decodeKey())
    .update(context)
    .update("\0")
    .update(value)
    .digest("hex");

export const sha256 = (value: Buffer | string): string =>
  createHash("sha256").update(value).digest("hex");
