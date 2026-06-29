import {
  authorizeApiKey,
  assertAuthorized,
  scopeCovers,
  ApiKeyAuthorizationError,
  WILDCARD_SCOPE,
  REASON,
  type ApiKeyRecord,
  type ToolRequest,
} from "@/lib/ai/apikeys/scope";

const NOW = 1_700_000_000_000;

function keyFor(orgId: string, scopes: string[], extra: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return { orgId, scopes, ...extra };
}

function requestFor(orgId: string, requiredPermission: string, tool = "search_creators"): ToolRequest {
  return { tool, requiredPermission, orgId };
}

describe("scopeCovers", () => {
  it("exact match covers the permission", () => {
    expect(scopeCovers(["creators:read"], "creators:read")).toBe(true);
  });

  it("wildcard covers any non-empty permission", () => {
    expect(scopeCovers([WILDCARD_SCOPE], "creators:write")).toBe(true);
    expect(scopeCovers([WILDCARD_SCOPE], "reports:export")).toBe(true);
  });

  it("empty scopes array covers nothing (fail-closed)", () => {
    expect(scopeCovers([], "creators:read")).toBe(false);
    expect(scopeCovers([], WILDCARD_SCOPE)).toBe(false);
  });

  it("malformed scope entries are ignored, valid sibling still matches", () => {
    const scopes = [null as unknown as string, "", 42 as unknown as string, "creators:read"];
    expect(scopeCovers(scopes, "creators:read")).toBe(true);
  });

  it("malformed scope entries alone cover nothing", () => {
    const scopes = [null as unknown as string, "", 42 as unknown as string];
    expect(scopeCovers(scopes, "creators:read")).toBe(false);
  });

  it("empty/non-string permission is never covered", () => {
    expect(scopeCovers([WILDCARD_SCOPE], "")).toBe(false);
    expect(scopeCovers(["creators:read"], undefined as unknown as string)).toBe(false);
  });
});

describe("authorizeApiKey", () => {
  it("allows when scope matches, same org, not expired/revoked", () => {
    const decision = authorizeApiKey(
      keyFor("orgA", ["creators:read"]),
      requestFor("orgA", "creators:read"),
      { nowEpochMs: NOW },
    );
    expect(decision).toEqual({ allowed: true, reason: REASON.allowed });
  });

  it("allows via wildcard scope", () => {
    const decision = authorizeApiKey(
      keyFor("orgA", [WILDCARD_SCOPE]),
      requestFor("orgA", "reports:export"),
      { nowEpochMs: NOW },
    );
    expect(decision).toEqual({ allowed: true, reason: REASON.allowed });
  });

  it("SECURITY: key.orgId != request.orgId is denied org_mismatch even with matching scope", () => {
    const decision = authorizeApiKey(
      keyFor("orgA", ["creators:read", WILDCARD_SCOPE]),
      requestFor("orgB", "creators:read"),
      { nowEpochMs: NOW },
    );
    expect(decision).toEqual({ allowed: false, reason: REASON.orgMismatch });
  });

  it("SECURITY: a malicious orgId carried in scopes cannot grant cross-tenant access", () => {
    const decision = authorizeApiKey(
      keyFor("orgA", ["orgB:tools:*", WILDCARD_SCOPE]),
      requestFor("orgB", "creators:read"),
      { nowEpochMs: NOW },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe(REASON.orgMismatch);
  });

  it("revoked key is denied (precedence over scope/org checks)", () => {
    const decision = authorizeApiKey(
      keyFor("orgA", [WILDCARD_SCOPE], { revoked: true }),
      requestFor("orgA", "creators:read"),
      { nowEpochMs: NOW },
    );
    expect(decision).toEqual({ allowed: false, reason: REASON.revoked });
  });

  it("expired key (expiresAtEpochMs < now) is denied", () => {
    const decision = authorizeApiKey(
      keyFor("orgA", ["creators:read"], { expiresAtEpochMs: NOW - 1 }),
      requestFor("orgA", "creators:read"),
      { nowEpochMs: NOW },
    );
    expect(decision).toEqual({ allowed: false, reason: REASON.expired });
  });

  it("boundary: expiresAtEpochMs == now is expired (fail-closed)", () => {
    const decision = authorizeApiKey(
      keyFor("orgA", ["creators:read"], { expiresAtEpochMs: NOW }),
      requestFor("orgA", "creators:read"),
      { nowEpochMs: NOW },
    );
    expect(decision).toEqual({ allowed: false, reason: REASON.expired });
  });

  it("not-yet-expired key (expiresAtEpochMs > now) is allowed", () => {
    const decision = authorizeApiKey(
      keyFor("orgA", ["creators:read"], { expiresAtEpochMs: NOW + 1 }),
      requestFor("orgA", "creators:read"),
      { nowEpochMs: NOW },
    );
    expect(decision).toEqual({ allowed: true, reason: REASON.allowed });
  });

  it("missing scope is denied scope_missing", () => {
    const decision = authorizeApiKey(
      keyFor("orgA", ["creators:read"]),
      requestFor("orgA", "creators:write"),
      { nowEpochMs: NOW },
    );
    expect(decision).toEqual({ allowed: false, reason: REASON.scopeMissing });
  });

  it("empty scopes is denied for any permission", () => {
    const decision = authorizeApiKey(
      keyFor("orgA", []),
      requestFor("orgA", "creators:read"),
      { nowEpochMs: NOW },
    );
    expect(decision).toEqual({ allowed: false, reason: REASON.scopeMissing });
  });

  it("malformed key is denied without throwing", () => {
    const bad = { scopes: ["creators:read"] } as unknown as ApiKeyRecord;
    const decision = authorizeApiKey(bad, requestFor("orgA", "creators:read"), { nowEpochMs: NOW });
    expect(decision).toEqual({ allowed: false, reason: REASON.malformedKey });
  });

  it("malformed request is denied without throwing", () => {
    const bad = { tool: "", requiredPermission: "", orgId: "" } as unknown as ToolRequest;
    const decision = authorizeApiKey(keyFor("orgA", [WILDCARD_SCOPE]), bad, { nowEpochMs: NOW });
    expect(decision).toEqual({ allowed: false, reason: REASON.malformedRequest });
  });

  it("malformed context (NaN/Infinity now) is denied without throwing", () => {
    const nan = authorizeApiKey(keyFor("orgA", [WILDCARD_SCOPE]), requestFor("orgA", "creators:read"), {
      nowEpochMs: Number.NaN,
    });
    expect(nan).toEqual({ allowed: false, reason: REASON.malformedContext });
    const inf = authorizeApiKey(keyFor("orgA", [WILDCARD_SCOPE]), requestFor("orgA", "creators:read"), {
      nowEpochMs: Number.POSITIVE_INFINITY,
    });
    expect(inf).toEqual({ allowed: false, reason: REASON.malformedContext });
  });

  it("unknown extra key fields are rejected as malformed (strict, fail-closed)", () => {
    const sneaky = {
      orgId: "orgA",
      scopes: [WILDCARD_SCOPE],
      bypass: true,
    } as unknown as ApiKeyRecord;
    const decision = authorizeApiKey(sneaky, requestFor("orgA", "creators:read"), { nowEpochMs: NOW });
    expect(decision).toEqual({ allowed: false, reason: REASON.malformedKey });
  });

  it("is deterministic: same input yields deep-equal output across calls", () => {
    const key = keyFor("orgA", ["creators:read"], { expiresAtEpochMs: NOW + 1000 });
    const req = requestFor("orgA", "creators:read");
    const a = authorizeApiKey(key, req, { nowEpochMs: NOW });
    const b = authorizeApiKey(key, req, { nowEpochMs: NOW });
    expect(a).toEqual(b);
    expect(a).toEqual({ allowed: true, reason: REASON.allowed });
  });
});

describe("assertAuthorized", () => {
  it("returns void (undefined) when allowed", () => {
    expect(
      assertAuthorized(keyFor("orgA", ["creators:read"]), requestFor("orgA", "creators:read"), {
        nowEpochMs: NOW,
      }),
    ).toBeUndefined();
  });

  it("throws a typed ApiKeyAuthorizationError with the deny reason on cross-tenant", () => {
    expect(() =>
      assertAuthorized(keyFor("orgA", [WILDCARD_SCOPE]), requestFor("orgB", "creators:read"), {
        nowEpochMs: NOW,
      }),
    ).toThrow(ApiKeyAuthorizationError);
    try {
      assertAuthorized(keyFor("orgA", [WILDCARD_SCOPE]), requestFor("orgB", "creators:read"), {
        nowEpochMs: NOW,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiKeyAuthorizationError);
      expect((err as ApiKeyAuthorizationError).reason).toBe(REASON.orgMismatch);
    }
  });

  it("throws on malformed key", () => {
    const bad = { scopes: [] } as unknown as ApiKeyRecord;
    expect(() => assertAuthorized(bad, requestFor("orgA", "creators:read"), { nowEpochMs: NOW })).toThrow(
      ApiKeyAuthorizationError,
    );
  });
});
