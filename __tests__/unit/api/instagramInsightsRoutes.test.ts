/**
 * @jest-environment node
 *
 * The three screens behind instagram_manage_insights:
 *   GET /api/portal/insights/instagram           — the creator's own account and story insights (My stats)
 *   GET /api/creators/[id]/instagram-insights    — the same, for the agency the creator granted
 *   GET /api/creators/[id]/instagram-discovery   — another account's public profile and posts, through
 *                                                  the agency's OWN Instagram account (Business Discovery)
 * Each reads through the grant gate or the agency's own credential only, and
 * nothing is cached or stored.
 */
const mockAuthenticate = jest.fn();
jest.mock("@/lib/authenticate", () => ({ authenticateRequest: () => mockAuthenticate() }));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/portal/creatorLink", () => ({ findLinkedCreatorsForHandle: jest.fn() }));
jest.mock("@/lib/creators/connectionGate", () => ({ connectionForRead: jest.fn() }));
jest.mock("@/lib/platforms/instagramToken", () => ({ ensureFreshInstagramToken: jest.fn() }));
jest.mock("@/lib/platforms/instagramAccount", () => ({ fetchInstagramAccount: jest.fn() }));
jest.mock("@/lib/platforms/instagramAccountInsights", () => ({ readInstagramInsightsBundle: jest.fn() }));
jest.mock("@/lib/platforms/instagramAgencyCredential", () => ({ getAgencyDiscoveryCredential: jest.fn() }));
jest.mock("@/lib/platforms/instagramDiscoveryProfile", () => {
  const actual = jest.requireActual("@/lib/platforms/instagramDiscoveryProfile");
  return { ...actual, readDiscoveryProfile: jest.fn() };
});
jest.mock("@/lib/db", () => ({
  db: {
    creator: { findFirst: jest.fn() },
    creatorProfileLink: { findFirst: jest.fn() },
  },
}));

import { NextRequest } from "next/server";
import { GET as portalGET } from "@/app/api/portal/insights/instagram/route";
import { GET as agencyInsightsGET } from "@/app/api/creators/[id]/instagram-insights/route";
import { GET as discoveryGET } from "@/app/api/creators/[id]/instagram-discovery/route";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { connectionForRead } from "@/lib/creators/connectionGate";
import { ensureFreshInstagramToken } from "@/lib/platforms/instagramToken";
import { fetchInstagramAccount } from "@/lib/platforms/instagramAccount";
import { readInstagramInsightsBundle } from "@/lib/platforms/instagramAccountInsights";
import { getAgencyDiscoveryCredential } from "@/lib/platforms/instagramAgencyCredential";
import { readDiscoveryProfile } from "@/lib/platforms/instagramDiscoveryProfile";
import { InstagramAuthError, InstagramNoSuchAccountError } from "@/lib/platforms/instagram";
import { db } from "@/lib/db";

const session = { id: "s-1", creatorUserId: "cu-1", email: "c@example.test", name: "Fake Creator", handle: "fake_creator_one" };
const connection = {
  id: "acc-1",
  creatorId: "cr-1",
  platform: "INSTAGRAM",
  handle: "fake_creator_one",
  origin: "oauth",
  platformUserId: "ig-1",
  accessToken: "enc",
  tokenExpiry: null,
};
const bundle = {
  account: {
    since: "2026-09-26T12:00:00.000Z",
    until: "2026-10-24T12:00:00.000Z",
    days: 28,
    totals: { reach: 10 },
    followerSeries: null,
    demographics: { country: [], age: [], gender: [] },
  },
  stories: [],
};
const profile = { username: "fake_brand", name: "Fake Brand", biography: null, website: null, profilePictureUrl: null, followers: 5, media: [] };
const agency = { token: "agency-token", igUserId: "agency-ig", username: "fake_agency", connectedAt: new Date() };

const portal = (account: string) =>
  portalGET(new NextRequest(`https://campaign.example.com/api/portal/insights/instagram?account=${encodeURIComponent(account)}`));
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const agencyInsights = (id = "cr-1") =>
  agencyInsightsGET(new NextRequest(`https://campaign.example.com/api/creators/${id}/instagram-insights`), params(id));
const discovery = (id = "cr-1") =>
  discoveryGET(new NextRequest(`https://campaign.example.com/api/creators/${id}/instagram-discovery`), params(id));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthenticate.mockResolvedValue({ orgId: "org-1", userId: "u-1" });
  (getCreatorSession as jest.Mock).mockResolvedValue(session);
  (findLinkedCreatorsForHandle as jest.Mock).mockResolvedValue([{ id: "cr-1", orgId: "org-1" }]);
  (connectionForRead as jest.Mock).mockResolvedValue({ ok: true, connection, grantId: "g-1" });
  (ensureFreshInstagramToken as jest.Mock).mockResolvedValue("user-token");
  (fetchInstagramAccount as jest.Mock).mockResolvedValue({ igUserId: "ig-from-page" });
  (readInstagramInsightsBundle as jest.Mock).mockResolvedValue(bundle);
  (db.creator.findFirst as jest.Mock).mockResolvedValue({ id: "cr-1", platform: "INSTAGRAM", handle: "@Fake_Brand" });
  (db.creatorProfileLink.findFirst as jest.Mock).mockResolvedValue(null);
  (getAgencyDiscoveryCredential as jest.Mock).mockResolvedValue(agency);
  (readDiscoveryProfile as jest.Mock).mockResolvedValue(profile);
});

describe("GET /api/portal/insights/instagram", () => {
  it("401s without a creator session and reads nothing", async () => {
    (getCreatorSession as jest.Mock).mockResolvedValue(null);
    expect((await portal("acc-1")).status).toBe(401);
    expect(readInstagramInsightsBundle).not.toHaveBeenCalled();
  });

  it("refuses an account id that is not an id", async () => {
    const res = await portal("../../me");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_account");
    expect(connectionForRead).not.toHaveBeenCalled();
  });

  it("returns the creator's own insights through the grant gate, uncached and marked not stored", async () => {
    const res = await portal("acc-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ handle: "fake_creator_one", stored: false, account: { days: 28, totals: { reach: 10 } }, stories: [] });
    expect(connectionForRead).toHaveBeenCalledWith("org-1", "cr-1", "INSTAGRAM", { where: { id: "acc-1" } });
    expect(readInstagramInsightsBundle).toHaveBeenCalledWith("user-token", "ig-1", expect.objectContaining({ now: expect.any(Date) }));
  });

  it("404s for an account the creator did not connect, and reads nothing", async () => {
    (connectionForRead as jest.Mock).mockResolvedValue({ ok: false });
    const res = await portal("acc-other");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_your_account");
    expect(readInstagramInsightsBundle).not.toHaveBeenCalled();
  });

  it("does not read an account connected with Instagram Login", async () => {
    (connectionForRead as jest.Mock).mockResolvedValue({ ok: true, connection: { ...connection, origin: "oauth_instagram_login" }, grantId: "g-1" });
    const res = await portal("acc-1");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("unsupported_login");
    expect(ensureFreshInstagramToken).not.toHaveBeenCalled();
  });

  it("asks for a reconnect when the token has lapsed or Instagram refuses it", async () => {
    (ensureFreshInstagramToken as jest.Mock).mockResolvedValueOnce(null);
    let res = await portal("acc-1");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("reauthorize");

    (readInstagramInsightsBundle as jest.Mock).mockRejectedValueOnce(new InstagramAuthError(400, 190, "expired"));
    res = await portal("acc-1");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("reauthorize");
  });

  it("finds the Instagram account through the Page when the row has no id, and says so when there is none", async () => {
    (connectionForRead as jest.Mock).mockResolvedValue({ ok: true, connection: { ...connection, platformUserId: null }, grantId: "g-1" });
    expect((await portal("acc-1")).status).toBe(200);
    expect(readInstagramInsightsBundle).toHaveBeenCalledWith("user-token", "ig-from-page", expect.anything());

    (fetchInstagramAccount as jest.Mock).mockResolvedValue(null);
    const res = await portal("acc-1");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_business_account");
  });
});

describe("GET /api/creators/[id]/instagram-insights", () => {
  it("401s without an agency session", async () => {
    mockAuthenticate.mockResolvedValue(null);
    expect((await agencyInsights()).status).toBe(401);
    expect(connectionForRead).not.toHaveBeenCalled();
  });

  it("404s for a creator outside the org", async () => {
    (db.creator.findFirst as jest.Mock).mockResolvedValue(null);
    expect((await agencyInsights("cr-x")).status).toBe(404);
    expect(db.creator.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "cr-x", orgId: "org-1", deletedAt: null } }));
    expect(connectionForRead).not.toHaveBeenCalled();
  });

  it("409s when the creator has not granted this org an Instagram connection", async () => {
    (connectionForRead as jest.Mock).mockResolvedValue({ ok: false });
    const res = await agencyInsights();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_connected");
    expect(readInstagramInsightsBundle).not.toHaveBeenCalled();
  });

  it("reads through the org's grant only, uncached", async () => {
    const res = await agencyInsights();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).stored).toBe(false);
    expect(connectionForRead).toHaveBeenCalledWith("org-1", "cr-1", "INSTAGRAM", { order: "newest" });
  });
});

describe("GET /api/creators/[id]/instagram-discovery", () => {
  it("401s without an agency session", async () => {
    mockAuthenticate.mockResolvedValue(null);
    expect((await discovery()).status).toBe(401);
    expect(readDiscoveryProfile).not.toHaveBeenCalled();
  });

  it("404s for a creator outside the org", async () => {
    (db.creator.findFirst as jest.Mock).mockResolvedValue(null);
    expect((await discovery("cr-x")).status).toBe(404);
    expect(readDiscoveryProfile).not.toHaveBeenCalled();
  });

  it("reads the creator's handle through the agency's own Instagram account, uncached", async () => {
    const res = await discovery();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ profile: { username: "fake_brand" }, via: { username: "fake_agency" }, stored: false });
    expect(getAgencyDiscoveryCredential).toHaveBeenCalledWith("org-1");
    expect(readDiscoveryProfile).toHaveBeenCalledWith("fake_brand", agency);
  });

  it("uses the creator's Instagram profile link when their main platform is another one", async () => {
    (db.creator.findFirst as jest.Mock).mockResolvedValue({ id: "cr-1", platform: "TIKTOK", handle: "tiktok_name" });
    (db.creatorProfileLink.findFirst as jest.Mock).mockResolvedValue({ handle: "ig_name" });
    expect((await discovery()).status).toBe(200);
    expect(db.creatorProfileLink.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { creatorId: "cr-1", orgId: "org-1", platform: "INSTAGRAM" } }),
    );
    expect(readDiscoveryProfile).toHaveBeenCalledWith("ig_name", agency);
  });

  it("409s when the creator has no Instagram handle", async () => {
    (db.creator.findFirst as jest.Mock).mockResolvedValue({ id: "cr-1", platform: "TIKTOK", handle: "tiktok_name" });
    const res = await discovery();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_instagram_handle");
    expect(readDiscoveryProfile).not.toHaveBeenCalled();
  });

  it("never reads without the agency's own connected account", async () => {
    (getAgencyDiscoveryCredential as jest.Mock).mockResolvedValue(null);
    const res = await discovery();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_agency_account");
    expect(readDiscoveryProfile).not.toHaveBeenCalled();
  });

  it("names a refused agency token, an account that is not professional, and a failed read", async () => {
    (readDiscoveryProfile as jest.Mock).mockRejectedValueOnce(new InstagramAuthError(400, 190, "expired"));
    let res = await discovery();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("agency_reauthorize");

    (readDiscoveryProfile as jest.Mock).mockRejectedValueOnce(new InstagramNoSuchAccountError(2207013));
    res = await discovery();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_professional");

    (readDiscoveryProfile as jest.Mock).mockResolvedValueOnce(null);
    res = await discovery();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("unreadable");
  });
});
