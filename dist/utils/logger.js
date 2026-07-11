const write = (level, message, context = {}) => {
    const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
        ...context,
    });
    if (level === "error")
        console.error(entry);
    else if (level === "warn")
        console.warn(entry);
    else
        console.info(entry);
};
export const logger = {
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, error, context = {}) => {
        const errorContext = error instanceof Error
            ? { error: error.message, stack: error.stack }
            : error === undefined
                ? {}
                : { error: String(error) };
        write("error", message, { ...context, ...errorContext });
    },
};
