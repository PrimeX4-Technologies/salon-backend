type LogContext = Record<string, unknown>;

const write = (
  level: "info" | "warn" | "error",
  message: string,
  context: LogContext = {},
): void => {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  });

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
          : { error: String(error) };

    write("error", message, { ...context, ...errorContext });
  },
};
