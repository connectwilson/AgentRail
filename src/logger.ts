/**
 * Structured JSON logger for AgentRail.
 * Writes to stderr so it doesn't interfere with the stdio JSON protocol on stdout.
 * Controlled by AGENTRAIL_LOG_LEVEL env var: silent | error | warn | info | debug
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

function getConfiguredLevel(): LogLevel {
  const env = (process.env["AGENTRAIL_LOG_LEVEL"] ?? "warn").toLowerCase();
  return (env in LEVELS ? env : "warn") as LogLevel;
}

type LogContext = Record<string, unknown>;

function emit(level: Exclude<LogLevel, "silent">, message: string, context?: LogContext) {
  const configured = LEVELS[getConfiguredLevel()];
  if (LEVELS[level] > configured) return;

  const entry: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...context
  };

  process.stderr.write(JSON.stringify(entry) + "\n");
}

export const logger = {
  debug(message: string, context?: LogContext) {
    emit("debug", message, context);
  },
  info(message: string, context?: LogContext) {
    emit("info", message, context);
  },
  warn(message: string, context?: LogContext) {
    emit("warn", message, context);
  },
  error(message: string, context?: LogContext) {
    emit("error", message, context);
  }
};

/** Wrap an async function call with timing + structured logging */
export async function loggedCall<T>(
  methodName: string,
  params: Record<string, unknown>,
  fn: () => Promise<T>
): Promise<T> {
  const startMs = Date.now();
  logger.debug("method.start", { method: methodName, params });
  try {
    const result = await fn();
    logger.info("method.ok", { method: methodName, durationMs: Date.now() - startMs });
    return result;
  } catch (error) {
    logger.error("method.error", {
      method: methodName,
      durationMs: Date.now() - startMs,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}
