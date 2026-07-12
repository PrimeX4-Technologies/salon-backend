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

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
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

// Node, cron expressions, recurring schedules, logs, and Intl formatters all
// inherit one business time zone. Persisted Date values still remain UTC.
process.env.TZ = timeZone;

export const config = Object.freeze({
  NODE_ENV: nodeEnv as "development" | "test" | "production",
  PORT: readNumber("PORT", 5000),
  MONGO_URI: readString("MONGO_URI"),
  REDIS_URL: readString("REDIS_URL"),
  JWT_SECRET: readString("JWT_SECRET"),
  CORS_ORIGIN: process.env.CORS_ORIGIN?.trim() || "*",
  TRUST_PROXY: process.env.TRUST_PROXY === "true" ? 1 : false,
  REQUEST_BODY_LIMIT: process.env.REQUEST_BODY_LIMIT?.trim() || "100kb",
  SHUTDOWN_TIMEOUT_MS: readNumber("SHUTDOWN_TIMEOUT_MS", 10_000),
  TIME_ZONE: timeZone,
});
