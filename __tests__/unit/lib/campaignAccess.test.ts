/**
 * @jest-environment node
 *
 * lib/campaignAccess.ts: the "assigned campaigns only" scope applied to a
 * campaign id. Free for unscoped callers, a 404 (never a 403) for a campaign
 * outside the caller's scope.
 */
jest.mock("@/lib/db", () => ({ db: { campaign: { findFirst: jest.fn() } } }));

import { db } from "@/lib/db";
import {
  accessSubjectFromSession,
  campaignScopeDenial,
  sessionCampaignScopeDenial,
} from "@/lib/campaignAccess";

const findFirst = (db as unknown as { campaign: { findFirst: jest.Mock } }).campaign.findFirst;

beforeEach(() => jest.clearAllMocks());

describe("campaignScopeDenial", () => {
  it.each([
    ["an OWNER on assigned-only", { role: "OWNER", campaignScope: "ASSIGNED" as const }],
    ["an ADMIN on assigned-only", { role: "ADMIN", campaignScope: "ASSIGNED" as const }],
    ["a MEMBER on all campaigns", { role: "MEMBER", campaignScope: "ALL" as const }],
    ["an API key", { role: null, campaignScope: null }],
  ])("costs nothing for %s", async (_label, who) => {
    const denied = await campaignScopeDenial({ orgId: "org-1", userId: "u1", ...who }, "camp-1");
    expect(denied).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("lets an assigned-only member reach a campaign they are on", async () => {
    findFirst.mockResolvedValue({ id: "camp-1" });
    const denied = await campaignScopeDenial(
      { orgId: "org-1", userId: "u1", role: "MEMBER", campaignScope: "ASSIGNED" },
      "camp-1"
    );
    expect(denied).toBeNull();
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: "camp-1",
      orgId: "org-1",
      OR: [{ teamMembers: { some: { userId: "u1" } } }, { createdById: "u1" }],
    });
  });

  it("answers a campaign outside the scope exactly like a missing one", async () => {
    findFirst.mockResolvedValue(null);
    const denied = await campaignScopeDenial(
      { orgId: "org-1", userId: "u1", role: "VIEWER", campaignScope: "ASSIGNED" },
      "camp-other"
    );
    expect(denied?.status).toBe(404);
    expect(await denied?.json()).toEqual({ error: "Campaign not found" });
  });
});

describe("sessionCampaignScopeDenial", () => {
  it("reads the scope off the session user", async () => {
    findFirst.mockResolvedValue(null);
    const denied = await sessionCampaignScopeDenial(
      { id: "u1", orgId: "org-1", role: "MEMBER", campaignScope: "ASSIGNED" },
      "camp-1"
    );
    expect(denied?.status).toBe(404);
  });

  it("refuses a session with no org", async () => {
    expect((await sessionCampaignScopeDenial({ id: "u1" }, "camp-1"))?.status).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("treats an unreadable scope as all campaigns, so a malformed token never hides a user's own work", () => {
    expect(accessSubjectFromSession({ id: "u1", orgId: "org-1", role: "MEMBER", campaignScope: 7 })).toEqual({
      orgId: "org-1",
      userId: "u1",
      role: "MEMBER",
      campaignScope: "ALL",
    });
  });
});
