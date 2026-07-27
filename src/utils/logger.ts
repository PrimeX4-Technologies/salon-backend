type LogContext = Record<string, unknown>;

const describeUnknown = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  ) {
    return value.toString();
  }
  if (value === null) return "null";

  try {
    return JSON.stringify(value) ?? "Unknown error";
  } catch {
    return Object.prototype.toString.call(value);
  }
};

const write = (
  level: "info" | "warn" | "error",
  message: string,
  context: LogContext = {},
): void => {
  const baseEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  let entry: string;
  try {
    entry = JSON.stringify(
      { ...baseEntry, ...context },
      (_key, value: unknown) => {
        if (typeof value === "bigint") return value.toString();
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
          };
        }
        return value;
      },
    );
  } catch {
    entry = JSON.stringify({
      ...baseEntry,
      serializationError: "Log context was not JSON serializable",
    });
  }

  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
};

export const logger = {
  info: (message: string, context?: LogContext): void => write("info", message, context),
  warn: (message: string, context?: LogContext): void => write("warn", message, context),
  error: (message: string, error?: unknown, context: LogContext = {}): void => {
    const errorContext =
      error instanceof Error
        ? { error: error.message, stack: error.stack }
        : error === undefined
          ? {}
          : { error: describeUnknown(error) };

    write("error", message, { ...context, ...errorContext });
  },
};
