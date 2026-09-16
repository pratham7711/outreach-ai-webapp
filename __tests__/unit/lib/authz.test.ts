/**
 * @jest-environment node
 */
import { permissionDenial, requirePermission } from "@/lib/authz";
import { authenticateRequest } from "@/lib/authenticate";
import { ACT_AS_ROLE } from "@/lib/platform/actAs";

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

/**
 * The session-side half of the same gate.
 *
 * It exists because several post routes authenticate through auth() rather than
 * authenticateRequest, and the interesting property is that both halves answer
 * the same question: what a VIEWER may not do through one must stay refused
 * through the other.
 */
describe("permissionDenial", () => {
  it("lets a role through when it holds the permission", () => {
    expect(permissionDenial({ role: "MEMBER" }, "campaigns:edit_own")).toBeNull();
    expect(permissionDenial({ role: "VIEWER" }, "campaigns:read")).toBeNull();
  });

  it("403s a VIEWER on a write", () => {
    const r = permissionDenial({ role: "VIEWER" }, "campaigns:edit_own");
    expect(r?.status).toBe(403);
  });

  it("fails closed on a missing or unreadable role", () => {
    // A session shape that changed, or a user row with no role, must not be
    // read as permission -- there is no orgId check left to catch it here.
    for (const user of [null, undefined, {}, { role: 7 }, { role: "" }, { role: "TYPO" }]) {
      expect(permissionDenial(user, "campaigns:read")?.status).toBe(403);
    }
  });

  it("refuses a post write in read-only act-as, and allows it in full", () => {
    /* The reason this gate was added: a platform operator inside a tenant in
       read mode carries the VIEWER role, so every route that only checked orgId
       let them approve, reject, track and sync posts. */
    expect(permissionDenial({ role: ACT_AS_ROLE.read }, "campaigns:edit_own")?.status).toBe(403);
    expect(permissionDenial({ role: ACT_AS_ROLE.read }, "campaigns:read")).toBeNull();
    expect(permissionDenial({ role: ACT_AS_ROLE.full }, "campaigns:edit_own")).toBeNull();
  });
});
