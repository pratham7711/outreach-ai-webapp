import { z } from "zod";

export const WILDCARD_SCOPE = "tools:*";

export interface ApiKeyRecord {
  orgId: string;
  scopes: string[];
  revoked?: boolean;
  expiresAtEpochMs?: number;
}

export interface ToolRequest {
  tool: string;
  requiredPermission: string;
  orgId: string;
}

export interface AuthorizeContext {
  nowEpochMs: number;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
}

export const REASON = {
  malformedKey: "malformed_key",
  malformedRequest: "malformed_request",
  malformedContext: "malformed_context",
  revoked: "revoked",
  expired: "expired",
  orgMismatch: "org_mismatch",
  scopeMissing: "scope_missing",
  allowed: "allowed",
} as const;

export type AuthorizationReason = (typeof REASON)[keyof typeof REASON];

export class ApiKeyAuthorizationError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`api key authorization denied: ${reason}`);
    this.name = "ApiKeyAuthorizationError";
    this.reason = reason;
  }
}

const finiteEpochMs = z
  .number()
  .refine((value) => Number.isFinite(value), { message: "must be finite" });

const apiKeyRecordSchema = z
  .object({
    orgId: z.string().min(1),
    scopes: z.array(z.string()),
    revoked: z.boolean().optional(),
    expiresAtEpochMs: finiteEpochMs.optional(),
  })
  .strict();

const toolRequestSchema = z
  .object({
    tool: z.string().min(1),
    requiredPermission: z.string().min(1),
    orgId: z.string().min(1),
  })
  .strict();

const authorizeContextSchema = z
  .object({
    nowEpochMs: finiteEpochMs,
  })
  .strict();

function isValidScopeEntry(entry: unknown): entry is string {
  return typeof entry === "string" && entry.length > 0;
}

export function scopeCovers(scopes: string[], permission: string): boolean {
  if (!Array.isArray(scopes)) {
    return false;
  }
  if (typeof permission !== "string" || permission.length === 0) {
    return false;
  }
  for (const entry of scopes) {
    if (!isValidScopeEntry(entry)) {
      continue;
    }
    if (entry === WILDCARD_SCOPE) {
      return true;
    }
    if (entry === permission) {
      return true;
    }
  }
  return false;
}

export function authorizeApiKey(
  key: ApiKeyRecord,
  request: ToolRequest,
  ctx: AuthorizeContext,
): AuthorizationDecision {
  const parsedKey = apiKeyRecordSchema.safeParse(key);
  if (!parsedKey.success) {
    return { allowed: false, reason: REASON.malformedKey };
  }
  const parsedRequest = toolRequestSchema.safeParse(request);
  if (!parsedRequest.success) {
    return { allowed: false, reason: REASON.malformedRequest };
  }
  const parsedCtx = authorizeContextSchema.safeParse(ctx);
  if (!parsedCtx.success) {
    return { allowed: false, reason: REASON.malformedContext };
  }

  const verifiedKey = parsedKey.data;
  const verifiedRequest = parsedRequest.data;
  const nowEpochMs = parsedCtx.data.nowEpochMs;

  if (verifiedKey.revoked === true) {
    return { allowed: false, reason: REASON.revoked };
  }

  if (
    typeof verifiedKey.expiresAtEpochMs === "number" &&
    verifiedKey.expiresAtEpochMs <= nowEpochMs
  ) {
    return { allowed: false, reason: REASON.expired };
  }

  if (verifiedKey.orgId !== verifiedRequest.orgId) {
    return { allowed: false, reason: REASON.orgMismatch };
  }

  if (!scopeCovers(verifiedKey.scopes, verifiedRequest.requiredPermission)) {
    return { allowed: false, reason: REASON.scopeMissing };
  }

  return { allowed: true, reason: REASON.allowed };
}

export function assertAuthorized(
  key: ApiKeyRecord,
  request: ToolRequest,
  ctx: AuthorizeContext,
): void {
  const decision = authorizeApiKey(key, request, ctx);
  if (!decision.allowed) {
    throw new ApiKeyAuthorizationError(decision.reason);
  }
}
