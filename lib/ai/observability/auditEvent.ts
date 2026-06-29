import { z } from "zod";

export interface RawToolCall {
  tool: string;
  orgId?: string;
  userId?: string;
  input?: unknown;
  output?: unknown;
  status?: string;
}

export interface AuditContext {
  orgId: string;
  userId?: string;
}

export interface AuditEvent {
  tool: string;
  orgId: string;
  userId?: string;
  status: string;
  input: unknown;
  output: unknown;
}

export const REDACTED = "[REDACTED]";
export const REDACTED_EMAIL = "[REDACTED_EMAIL]";
export const REDACTED_SSN = "[REDACTED_SSN]";
export const CIRCULAR = "[CIRCULAR]";

const rawToolCallSchema = z.object({
  tool: z.string().optional(),
  orgId: z.string().optional(),
  userId: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  status: z.string().optional(),
});

const ctxSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().optional(),
});

const SECRET_KEY_PATTERNS: RegExp[] = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /ssn/i,
  /credit[_-]?card/i,
  /card/i,
  /access[_-]?key/i,
  /private[_-]?key/i,
  /bearer/i,
];

const EMAIL_PATTERN =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/;

const BEARER_PATTERN = /\bbearer\s+[A-Za-z0-9._\-+/=]{8,}/i;

const LONG_SECRET_PATTERN = /(?:[A-Za-z0-9+/=_-]){20,}/;

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;

function isKeyRedacted(key: string): boolean {
  for (const pattern of SECRET_KEY_PATTERNS) {
    if (pattern.test(key)) {
      return true;
    }
  }
  return false;
}

function looksLikeCard(value: string): boolean {
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(digits)) {
    return false;
  }
  return digits.length >= 13 && digits.length <= 19;
}

function looksLikeLongSecret(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 20) {
    return false;
  }
  const match = LONG_SECRET_PATTERN.exec(trimmed);
  if (!match) {
    return false;
  }
  const hasUpper = /[A-Z]/.test(trimmed);
  const hasLower = /[a-z]/.test(trimmed);
  const hasDigit = /\d/.test(trimmed);
  const hasSymbol = /[+/=_-]/.test(trimmed);
  const classes =
    (hasUpper ? 1 : 0) +
    (hasLower ? 1 : 0) +
    (hasDigit ? 1 : 0) +
    (hasSymbol ? 1 : 0);
  const isHex = /^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length >= 20;
  return isHex || classes >= 2;
}

function redactString(value: string): string {
  if (EMAIL_PATTERN.test(value)) {
    return REDACTED_EMAIL;
  }
  if (JWT_PATTERN.test(value)) {
    return REDACTED;
  }
  if (BEARER_PATTERN.test(value)) {
    return REDACTED;
  }
  if (SSN_PATTERN.test(value)) {
    return REDACTED_SSN;
  }
  if (looksLikeCard(value)) {
    return REDACTED;
  }
  if (looksLikeLongSecret(value)) {
    return REDACTED;
  }
  return value;
}

function redactInternal(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const valueType = typeof value;

  if (valueType === "string") {
    return redactString(value as string);
  }

  if (valueType === "number") {
    if (!Number.isFinite(value as number)) {
      return null;
    }
    return value;
  }

  if (valueType === "boolean") {
    return value;
  }

  if (valueType === "bigint") {
    return (value as bigint).toString();
  }

  if (valueType === "function" || valueType === "symbol") {
    return undefined;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return CIRCULAR;
    }
    seen.add(value);
    const result = value.map((item) => redactInternal(item, seen));
    seen.delete(value);
    return result;
  }

  if (valueType === "object") {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) {
      return CIRCULAR;
    }
    seen.add(obj);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (isKeyRedacted(key)) {
        out[key] = REDACTED;
        continue;
      }
      const child = obj[key];
      const childType = typeof child;
      if (childType === "function" || childType === "symbol") {
        continue;
      }
      out[key] = redactInternal(child, seen);
    }
    seen.delete(obj);
    return out;
  }

  return undefined;
}

export function redactValue(value: unknown): unknown {
  return redactInternal(value, new WeakSet<object>());
}

export function buildAuditEvent(
  raw: RawToolCall,
  ctx: AuditContext,
): AuditEvent {
  const safeRaw = rawToolCallSchema.parse(raw ?? {});
  const safeCtx = ctxSchema.parse(ctx);

  const event: AuditEvent = {
    tool: typeof safeRaw.tool === "string" ? safeRaw.tool : "",
    orgId: safeCtx.orgId,
    status: typeof safeRaw.status === "string" ? safeRaw.status : "unknown",
    input: redactValue(safeRaw.input ?? null),
    output: redactValue(safeRaw.output ?? null),
  };

  if (typeof safeCtx.userId === "string" && safeCtx.userId.length > 0) {
    event.userId = safeCtx.userId;
  }

  return event;
}
