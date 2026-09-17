type Level = "debug" | "info" | "warn" | "error";

/* "silent" is a threshold, never something anything logs AT -- it sits above
   every level so nothing clears it. The test runs are what need it: a suite
   that writes 46KB of application logs to stdout has its output persisted to a
   file by the harness, and the deploy gate then sees no pass summary and
   withholds the receipt for a suite that was entirely green. */
type Threshold = Level | "silent";

const LEVELS: Record<Threshold, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };

function resolveLevel(): Threshold {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error" || raw === "silent") return raw;
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
