/**
 * @jest-environment node
 *
 * Tests for authenticateRequest() — the shared auth utility that validates
 * both NextAuth session cookies and Bearer API keys.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    apiKey: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));

import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";

const mockAuth = auth as jest.Mock;
const mockDb = db as any;

const VALID_KEY = "oai_abc123def456ghi789jkl012mno345pq"; // exactly 36 chars: 4 prefix + 32
// SHA-256 of the above — authenticate.ts computes this at runtime
const VALID_KEY_HASH = require("crypto")
  .createHash("sha256")
  .update(VALID_KEY)
  .digest("hex");

function makeRequest(headers?: Record<string, string>) {
  return new NextRequest("http://localhost/api/campaigns", { headers });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue(null); // no session by default
  mockDb.apiKey.update.mockResolvedValue({});
});

// ─── Session auth ─────────────────────────────────────────────────────────────

describe("authenticateRequest — session auth", () => {
  it("returns AuthResult when a valid session exists", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-1", email: "a@b.com" } });
    const result = await authenticateRequest(makeRequest());
    expect(result).not.toBeNull();
    expect(result!.orgId).toBe("org-1");
    expect(result!.userId).toBe("user-1");
    expect(result!.actorType).toBe("user");
  });

  it("returns null when session is missing", async () => {
    mockAuth.mockResolvedValue(null);
    const result = await authenticateRequest(makeRequest());
    expect(result).toBeNull();
  });

  it("session takes precedence over a valid Bearer token", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1", orgId: "org-session", email: "a@b.com" } });
    mockDb.apiKey.findUnique.mockResolvedValue({ id: "key-1", orgId: "org-key", name: "Test" });

    const result = await authenticateRequest(
      makeRequest({ authorization: `Bearer ${VALID_KEY}` })
    );
    expect(result).not.toBeNull();
    expect(result!.orgId).toBe("org-session");
    expect(result!.actorType).toBe("user");
    // API key lookup should NOT have been called
    expect(mockDb.apiKey.findUnique).not.toHaveBeenCalled();
  });
});

// ─── API key auth ─────────────────────────────────────────────────────────────

describe("authenticateRequest — Bearer API key auth", () => {
  it("returns AuthResult for a valid Bearer key", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "key-1",
      orgId: "org-1",
      name: "Prod Key",
    });

    const result = await authenticateRequest(
      makeRequest({ authorization: `Bearer ${VALID_KEY}` })
    );

    expect(result).not.toBeNull();
    expect(result!.orgId).toBe("org-1");
    expect(result!.userId).toBeNull();
    expect(result!.actorType).toBe("api_key");

    // Verify the hash sent to DB matches what SHA-256 of the key produces
    expect(mockDb.apiKey.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { keyHash: VALID_KEY_HASH },
      })
    );
  });

  it("updates lastUsedAt after a successful API key auth", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue({
      id: "key-1",
      orgId: "org-1",
      name: "Prod Key",
    });

    await authenticateRequest(makeRequest({ authorization: `Bearer ${VALID_KEY}` }));

    // Give the fire-and-forget update a tick to register
    await new Promise((r) => setImmediate(r));

    expect(mockDb.apiKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "key-1" },
        data: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
      })
    );
  });

  it("returns null for an invalid / unknown Bearer key", async () => {
    mockDb.apiKey.findUnique.mockResolvedValue(null);

    const result = await authenticateRequest(
      makeRequest({ authorization: "Bearer oai_badkey00000000000000000000000000" })
    );

    expect(result).toBeNull();
    expect(mockDb.apiKey.update).not.toHaveBeenCalled();
  });

  it("returns null for a Bearer token without the oai_ prefix", async () => {
    const result = await authenticateRequest(
      makeRequest({ authorization: "Bearer some_random_token_without_prefix" })
    );
    expect(result).toBeNull();
    expect(mockDb.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when no Authorization header is present", async () => {
    const result = await authenticateRequest(makeRequest());
    expect(result).toBeNull();
    expect(mockDb.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("returns null for a token that is too short", async () => {
    const result = await authenticateRequest(
      makeRequest({ authorization: "Bearer oai_short" })
    );
    expect(result).toBeNull();
    expect(mockDb.apiKey.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when no request is passed", async () => {
    const result = await authenticateRequest(undefined);
    expect(result).toBeNull();
  });
});

// ─── getAuditActor ────────────────────────────────────────────────────────────

describe("getAuditActor", () => {
  it("returns correct actor for a user session", () => {
    const result = {
      orgId: "org-1",
      userId: "user-1",
      actorEmail: "a@b.com",
      actorType: "user" as const,
    };
    const actor = getAuditActor(result);
    expect(actor.userId).toBe("user-1");
    expect(actor.actorEmail).toBe("a@b.com");
    expect(actor.actorType).toBe("user");
  });

  it("returns correct actor for an API key request", () => {
    const result = {
      orgId: "org-1",
      userId: null,
      actorEmail: null,
      actorType: "api_key" as const,
    };
    const actor = getAuditActor(result);
    expect(actor.userId).toBeUndefined();
    expect(actor.actorEmail).toBeUndefined();
    expect(actor.actorType).toBe("api_key");
  });
});
