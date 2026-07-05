import { createLogger, type Logger } from "@/lib/observability/logger";

export interface RequestLog {
  requestId: string;
  logger: Logger;
}

export function requestLogger(route: string, context: Record<string, unknown> = {}): RequestLog {
  const requestId = crypto.randomUUID();
  const logger = createLogger({ requestId, context: { route, ...context } });
  return { requestId, logger };
}
