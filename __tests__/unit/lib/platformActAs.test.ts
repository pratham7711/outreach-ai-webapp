/**
 * The platform operator's org switch.
 *
 * Everything here is a refusal test. The feature reads one cookie and decides
 * whose data the whole request sees, so the cases worth pinning are the ones
 * where it must decide "nobody's but your own": a tenant holding a copied
 * cookie, a malformed value, an org that has since been deleted.
 */
const mockOrgFindUnique = jest.fn();
jest.mock("@/lib/db", () => ({
  db: { organization: { findUnique: (...a: any[]) => mockOrgFindUnique(...a) } },
}));

import { applyActingAs, encodeActAs, parseActAs, resolveActAs } from "@/lib/platform/actAs";
import type { ActingAs } from "@/lib/platform/actAs";

const OPERATOR = "ops@madeboring.com";
const TENANT = "someone@agency.com";
const HOME = "org-home";
const TARGET = "org-target";

describe("parseActAs", () => {
  it("reads a well-formed switch", () => {
    expect(parseActAs(encodeActAs(TARGET, "read"))).toEqual({ orgId: TARGET, mode: "read" });
    expect(parseActAs(encodeActAs(TARGET, "full"))).toEqual({ orgId: TARGET, mode: "full" });
  });

  it("refuses anything else", () => {
    expect(parseActAs(null)).toBeNull();
    expect(parseActAs("")).toBeNull();
    expect(parseActAs(TARGET)).toBeNull();
    expect(parseActAs(`${TARGET}|admin`)).toBeNull();
    expect(parseActAs("|read")).toBeNull();
  });
});

describe("resolveActAs", () => {
  const OLD_ENV = process.env.PLATFORM_ADMIN_EMAILS;

  beforeEach(() => {
    process.env.PLATFORM_ADMIN_EMAILS = OPERATOR;
    mockOrgFindUnique.mockReset().mockResolvedValue({ id: TARGET, name: "Target Agency" });
  });

  afterAll(() => {
    process.env.PLATFORM_ADMIN_EMAILS = OLD_ENV;
  });

  it("switches an operator to the org named by the cookie", async () => {
    await expect(resolveActAs(OPERATOR, encodeActAs(TARGET, "read"), HOME)).resolves.toEqual({
      orgId: TARGET,
      orgName: "Target Agency",
      mode: "read",
      homeOrgId: HOME,
    });
  });

  it("ignores the cookie for anyone not on the allowlist", async () => {
    await expect(resolveActAs(TENANT, encodeActAs(TARGET, "full"), HOME)).resolves.toBeNull();
    expect(mockOrgFindUnique).not.toHaveBeenCalled();
  });

  it("ignores a cookie naming the operator's own org", async () => {
    await expect(resolveActAs(OPERATOR, encodeActAs(HOME, "full"), HOME)).resolves.toBeNull();
  });

  it("ignores a cookie naming an org that no longer exists", async () => {
    mockOrgFindUnique.mockResolvedValue(null);
    await expect(resolveActAs(OPERATOR, encodeActAs(TARGET, "read"), HOME)).resolves.toBeNull();
  });

  it("ignores a malformed cookie without touching the database", async () => {
    await expect(resolveActAs(OPERATOR, "garbage", HOME)).resolves.toBeNull();
    expect(mockOrgFindUnique).not.toHaveBeenCalled();
  });

  it("ignores a missing cookie", async () => {
    await expect(resolveActAs(OPERATOR, null, HOME)).resolves.toBeNull();
  });
});

describe("applyActingAs", () => {
  const session = (): {
    user: {
      email: string;
      orgId: string;
      role: string;
      campaignScope: string;
      actingAs?: ActingAs;
    };
  } => ({
    user: { email: OPERATOR, orgId: HOME, role: "OWNER", campaignScope: "ASSIGNED" },
  });

  it("leaves the session alone when nobody is acting", () => {
    const s = session();
    expect(applyActingAs(s, null).user).toMatchObject({ orgId: HOME, role: "OWNER" });
  });

  it("read mode lands on the app's own read-only seat", () => {
    const s = applyActingAs(session(), {
      orgId: TARGET, orgName: "Target Agency", mode: "read", homeOrgId: HOME,
    });
    expect(s.user).toMatchObject({ orgId: TARGET, role: "VIEWER" });
  });

  it("full mode lands on the seat that can repair things", () => {
    const s = applyActingAs(session(), {
      orgId: TARGET, orgName: "Target Agency", mode: "full", homeOrgId: HOME,
    });
    expect(s.user).toMatchObject({ orgId: TARGET, role: "OWNER" });
  });

  it("drops the operator's own row scope, which describes their own org", () => {
    const s = applyActingAs(session(), {
      orgId: TARGET, orgName: "Target Agency", mode: "read", homeOrgId: HOME,
    });
    // ASSIGNED would hide every campaign in a workspace the operator is on no
    // team of -- an empty tenant that reads as a broken one.
    expect(s.user?.campaignScope).toBe("ALL");
  });

  it("carries the org's name and the way home, for the banner", () => {
    const s = applyActingAs(session(), {
      orgId: TARGET, orgName: "Target Agency", mode: "full", homeOrgId: HOME,
    });
    expect(s.user?.actingAs).toEqual({
      orgId: TARGET, orgName: "Target Agency", mode: "full", homeOrgId: HOME,
    });
  });

  it("keeps the operator's own identity, so the allowlist still recognises them", () => {
    const s = applyActingAs(session(), {
      orgId: TARGET, orgName: "Target Agency", mode: "read", homeOrgId: HOME,
    });
    expect(s.user?.email).toBe(OPERATOR);
  });
});
