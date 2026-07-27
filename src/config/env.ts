import "dotenv/config";

const readString = (name: string, fallback?: string): string => {
  const value = process.env[name]?.trim() || fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const readNumber = (name: string, fallback: number): number => {
  const rawValue = process.env[name];
  const value = rawValue === undefined ? fallback : Number(rawValue);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
};

const readPort = (): number => {
  const port = readNumber("PORT", 5000);
  if (port > 65_535) {
    throw new Error("PORT must be between 1 and 65535");
  }
  return port;
};

const readOptionalString = (name: string): string | undefined =>
  process.env[name]?.trim() || undefined;

const readOptionalEncryptionKey = (name: string): string | undefined => {
  const value = readOptionalString(name);
  if (!value) return undefined;

  const isHex = /^[0-9a-f]{64}$/i.test(value);
  const isBase64 = /^[A-Za-z0-9+/_-]+={0,2}$/.test(value);
  const decoded = isHex
    ? Buffer.from(value, "hex")
    : isBase64
      ? Buffer.from(value, "base64url")
      : Buffer.alloc(0);

  if (decoded.length !== 32) {
    throw new Error(
      `${name} must be exactly 32 bytes encoded as 64 hexadecimal characters or base64url`,
    );
  }
  return value;
};

const readBoolean = (name: string, fallback: boolean): boolean => {
  const rawValue = process.env[name]?.trim().toLowerCase();
  if (rawValue === undefined || rawValue === "") return fallback;
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  throw new Error(`${name} must be true or false`);
};

const readSameSite = (): "lax" | "strict" | "none" => {
  const value = process.env.AUTH_COOKIE_SAME_SITE?.trim().toLowerCase() || "lax";
  if (value !== "lax" && value !== "strict" && value !== "none") {
    throw new Error("AUTH_COOKIE_SAME_SITE must be lax, strict, or none");
  }
  return value;
};

const readTimeZone = (name: string, fallback: string): string => {
  const value = process.env[name]?.trim() || fallback;

  try {
    Intl.DateTimeFormat("en", { timeZone: value });
    return value;
  } catch {
    throw new Error(`${name} must be a valid IANA time zone`);
  }
};

const nodeEnv = process.env.NODE_ENV ?? "development";
const supportedEnvironments = new Set(["development", "test", "production"]);

if (!supportedEnvironments.has(nodeEnv)) {
  throw new Error("NODE_ENV must be development, test, or production");
}

const timeZone = readTimeZone("TZ", "Asia/Colombo");
const legacyJwtSecret = readOptionalString("JWT_SECRET");
const jwtAccessSecret = readOptionalString("JWT_ACCESS_SECRET") ?? legacyJwtSecret;
const jwtRefreshSecret = readOptionalString("JWT_REFRESH_SECRET") ?? legacyJwtSecret;
const authActionTokenSecret =
  readOptionalString("AUTH_ACTION_TOKEN_SECRET") ?? jwtRefreshSecret;

if (!jwtAccessSecret) {
  throw new Error("Missing required environment variable: JWT_ACCESS_SECRET");
}
if (!jwtRefreshSecret) {
  throw new Error("Missing required environment variable: JWT_REFRESH_SECRET");
}
if (!authActionTokenSecret) {
  throw new Error("Missing required environment variable: AUTH_ACTION_TOKEN_SECRET");
}
if (Buffer.byteLength(jwtAccessSecret, "utf8") < 32) {
  throw new Error("JWT_ACCESS_SECRET must contain at least 32 UTF-8 bytes");
}
if (Buffer.byteLength(jwtRefreshSecret, "utf8") < 32) {
  throw new Error("JWT_REFRESH_SECRET must contain at least 32 UTF-8 bytes");
}
if (nodeEnv === "production" && jwtAccessSecret === jwtRefreshSecret) {
  throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production");
}
if (Buffer.byteLength(authActionTokenSecret, "utf8") < 32) {
  throw new Error("AUTH_ACTION_TOKEN_SECRET must contain at least 32 UTF-8 bytes");
}
if (
  nodeEnv === "production" &&
  (authActionTokenSecret === jwtAccessSecret ||
    authActionTokenSecret === jwtRefreshSecret)
) {
  throw new Error(
    "AUTH_ACTION_TOKEN_SECRET must be different from JWT secrets in production",
  );
}

const authCookieSameSite = readSameSite();
const authCookieSecure = readBoolean("AUTH_COOKIE_SECURE", nodeEnv === "production");
if (authCookieSameSite === "none" && !authCookieSecure) {
  throw new Error("AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAME_SITE is none");
}
if (nodeEnv === "production" && !authCookieSecure) {
  throw new Error("AUTH_COOKIE_SECURE must be true in production");
}

const corsOrigin = process.env.CORS_ORIGIN?.trim() || "*";
if (
  nodeEnv === "production" &&
  corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .includes("*")
) {
  throw new Error("CORS_ORIGIN must list explicit trusted origins in production");
}

// Node, cron expressions, recurring schedules, logs, and Intl formatters all
// inherit one business time zone. Persisted Date values still remain UTC.
process.env.TZ = timeZone;

export const config = Object.freeze({
  NODE_ENV: nodeEnv as "development" | "test" | "production",
  PORT: readPort(),
  MONGO_URI: readString("MONGO_URI"),
  REDIS_URL: readString("REDIS_URL"),
  JWT_ACCESS_SECRET: jwtAccessSecret,
  JWT_REFRESH_SECRET: jwtRefreshSecret,
  JWT_ACCESS_TTL_SECONDS: readNumber("JWT_ACCESS_TTL_SECONDS", 15 * 60),
  JWT_REFRESH_TTL_SECONDS: readNumber("JWT_REFRESH_TTL_SECONDS", 30 * 24 * 60 * 60),
  JWT_ISSUER: readString("JWT_ISSUER", "salon-booking-api"),
  JWT_AUDIENCE: readString("JWT_AUDIENCE", "salon-booking-client"),
  GOOGLE_CLIENT_ID: readOptionalString("GOOGLE_CLIENT_ID"),
  AUTH_MAX_FAILED_ATTEMPTS: readNumber("AUTH_MAX_FAILED_ATTEMPTS", 5),
  AUTH_LOCK_SECONDS: readNumber("AUTH_LOCK_SECONDS", 15 * 60),
  AUTH_REFRESH_COOKIE_NAME: readString("AUTH_REFRESH_COOKIE_NAME", "salon_refresh"),
  AUTH_CSRF_COOKIE_NAME: readString("AUTH_CSRF_COOKIE_NAME", "salon_csrf"),
  AUTH_COOKIE_SECURE: authCookieSecure,
  AUTH_COOKIE_SAME_SITE: authCookieSameSite,
  AUTH_RETURN_REFRESH_TOKEN: readBoolean("AUTH_RETURN_REFRESH_TOKEN", false),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: readNumber("AUTH_RATE_LIMIT_WINDOW_SECONDS", 15 * 60),
  AUTH_RATE_LIMIT_MAX: readNumber("AUTH_RATE_LIMIT_MAX", 10),
  AUTH_ACTION_TOKEN_SECRET: authActionTokenSecret,
  AUTH_PASSWORD_RESET_TTL_SECONDS: readNumber(
    "AUTH_PASSWORD_RESET_TTL_SECONDS",
    15 * 60,
  ),
  AUTH_EMAIL_VERIFICATION_TTL_SECONDS: readNumber(
    "AUTH_EMAIL_VERIFICATION_TTL_SECONDS",
    24 * 60 * 60,
  ),
  DATA_ENCRYPTION_KEY: readOptionalEncryptionKey("DATA_ENCRYPTION_KEY"),
  CORS_ORIGIN: corsOrigin,
  API_RATE_LIMIT_WINDOW_SECONDS: readNumber(
    "API_RATE_LIMIT_WINDOW_SECONDS",
    60,
  ),
  API_RATE_LIMIT_MAX: readNumber("API_RATE_LIMIT_MAX", 1_000),
  PAYMENT_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS: readNumber(
    "PAYMENT_WEBHOOK_RATE_LIMIT_WINDOW_SECONDS",
    60,
  ),
  PAYMENT_WEBHOOK_RATE_LIMIT_MAX: readNumber(
    "PAYMENT_WEBHOOK_RATE_LIMIT_MAX",
    300,
  ),
  TRUST_PROXY: readBoolean("TRUST_PROXY", false) ? 1 : false,
  REQUEST_BODY_LIMIT: process.env.REQUEST_BODY_LIMIT?.trim() || "100kb",
  SHUTDOWN_TIMEOUT_MS: readNumber("SHUTDOWN_TIMEOUT_MS", 10_000),
  TIME_ZONE: timeZone,
});
