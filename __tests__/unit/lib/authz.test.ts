/**
 * @jest-environment node
 */
import { requirePermission } from "@/lib/authz";
import { authenticateRequest } from "@/lib/authenticate";

jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: jest.fn(),
}));

const mockAuth = authenticateRequest as jest.Mock;

function auth(role: string | null, actorType: "user" | "api_key" = "user") {
  return { orgId: "org-1", userId: "u-1", actorEmail: "a@b.com", actorType, role };
}

describe("requirePermission", () => {
  afterEach(() => mockAuth.mockReset());

  it("401 when unauthenticated", async () => {
    mockAuth.mockResolvedValue(null);
    const r = await requirePermission(undefined, "campaigns:create");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  it("403 when a VIEWER tries to create a campaign", async () => {
    mockAuth.mockResolvedValue(auth("VIEWER"));
    const r = await requirePermission(undefined, "campaigns:create");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });

  it("allows OWNER via wildcard on any permission", async () => {
    mockAuth.mockResolvedValue(auth("OWNER"));
    expect((await requirePermission(undefined, "campaigns:delete")).ok).toBe(true);
    expect((await requirePermission(undefined, "payments:manage")).ok).toBe(true);
  });

  it("MEMBER can create but NOT delete campaigns", async () => {
    mockAuth.mockResolvedValue(auth("MEMBER"));
    expect((await requirePermission(undefined, "campaigns:create")).ok).toBe(true);
    expect((await requirePermission(undefined, "campaigns:delete")).ok).toBe(false);
  });

  it("MANAGER has campaigns:* but not payments:manage", async () => {
    mockAuth.mockResolvedValue(auth("MANAGER"));
    expect((await requirePermission(undefined, "campaigns:edit")).ok).toBe(true);
    expect((await requirePermission(undefined, "payments:manage")).ok).toBe(false);
  });

  it("MEMBER passes the campaigns:edit_own gate; VIEWER does not", async () => {
    mockAuth.mockResolvedValue(auth("MEMBER"));
    expect((await requirePermission(undefined, "campaigns:edit_own")).ok).toBe(true);
    mockAuth.mockResolvedValue(auth("VIEWER"));
    expect((await requirePermission(undefined, "campaigns:edit_own")).ok).toBe(false);
  });

  it("settings:manage (API-key minting) is OWNER/ADMIN only", async () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      mockAuth.mockResolvedValue(auth(role));
      expect((await requirePermission(undefined, "settings:manage")).ok).toBe(true);
    }
    for (const role of ["MANAGER", "MEMBER", "VIEWER"] as const) {
      mockAuth.mockResolvedValue(auth(role));
      expect((await requirePermission(undefined, "settings:manage")).ok).toBe(false);
    }
  });

  it("API keys act as org service accounts (minting them is gated at POST /api/keys via settings:manage)", async () => {
    mockAuth.mockResolvedValue(auth(null, "api_key"));
    expect((await requirePermission(undefined, "campaigns:delete")).ok).toBe(true);
  });
});
