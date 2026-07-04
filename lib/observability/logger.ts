type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function resolveLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

function emit(level: Level, msg: string, requestId: string | undefined, context: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[resolveLevel()]) return;
  const entry: Record<string, unknown> = { ts: new Date().toISOString(), level, msg };
  if (requestId !== undefined) entry.requestId = requestId;
  if (Object.keys(context).length > 0) entry.context = context;
  process.stdout.write(JSON.stringify(entry) + "\n");
}

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  child(ctx: Record<string, unknown>): Logger;
}

function makeLogger(requestId: string | undefined, baseCtx: Record<string, unknown>): Logger {
  return {
    debug: (msg, extra = {}) => emit("debug", msg, requestId, { ...baseCtx, ...extra }),
    info:  (msg, extra = {}) => emit("info",  msg, requestId, { ...baseCtx, ...extra }),
    warn:  (msg, extra = {}) => emit("warn",  msg, requestId, { ...baseCtx, ...extra }),
    error: (msg, extra = {}) => emit("error", msg, requestId, { ...baseCtx, ...extra }),
    child: (ctx) => makeLogger(requestId, { ...baseCtx, ...ctx }),
  };
}

export function createLogger(opts?: { requestId?: string; context?: Record<string, unknown> }): Logger {
  return makeLogger(opts?.requestId, opts?.context ?? {});
}
