/**
 * @jest-environment node
 *
 * Who may see a stored campaign picture.
 *
 * The share route answers anyone holding a link and names no campaign, so a
 * link can only ever reach its own campaign's picture. The dashboard route
 * answers a session and holds to the session's org. Both serve a copy only
 * while the campaign still points at the picture it was taken from.
 *
 * The database is a small in-memory one that evaluates the `where` the routes
 * build, so a filter dropped from a query fails here even if the call still
 * looks right.
 */
import { NextRequest } from "next/server";

const UPLOAD = (f: string) => `https://x.cdn.bubble.io/${f}/image.png`;
type CampaignRow = { id: string; orgId: string; thumbnailUrl: string | null; copy: Record<string, unknown> | null };
const copyOf = (f: string, bytes: number[]) => ({
  data: new Uint8Array(bytes),
  fetchedAt: new Date(1000),
  sourceUrl: UPLOAD(f),
  failedAt: null,
});
const CAMPAIGNS: CampaignRow[] = [
  { id: "camp-a", orgId: "org-1", thumbnailUrl: `//x.cdn.bubble.io/f1/image.png`, copy: copyOf("f1", [1, 2, 3]) },
  { id: "camp-moved", orgId: "org-1", thumbnailUrl: UPLOAD("f2"), copy: copyOf("f1", [7]) },
  { id: "camp-x", orgId: "org-2", thumbnailUrl: UPLOAD("f3"), copy: copyOf("f3", [4, 5, 6]) },
];

type CampaignWhere = { id: string; orgId: string };
const mockFindFirst = jest.fn(async ({ where }: { where: CampaignWhere }) => {
  const row = CAMPAIGNS.find((c) => c.id === where.id && c.orgId === where.orgId);
  return row ? { thumbnailUrl: row.thumbnailUrl, thumbnailCopy: row.copy } : null;
});

const report = (campaignId: string | null, orgId = "org-1", campaignOrg = orgId) => ({
  isPublic: true,
  orgId,
  campaignId,
  config: { kind: "campaign-performance" },
  campaign: campaignId ? { orgId: campaignOrg } : null,
});
const links: Record<string, Record<string, unknown>> = {
  "tok-a": report("camp-a"),
  "tok-moved": report("camp-moved"),
  "tok-revoked": { ...report("camp-a"), isPublic: false },
  "tok-other-kind": { ...report("camp-a"), config: { kind: "roster" } },
  "tok-no-campaign": report(null),
  // A link whose row and campaign disagree on the tenant answers nothing.
  "tok-crossed": report("camp-x", "org-1", "org-2"),
};

const mockAuthenticate = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    report: {
      findUnique: async ({ where }: { where: { shareToken: string } }) => links[where.shareToken] ?? null,
    },
    campaign: { findFirst: (a: { where: CampaignWhere }) => mockFindFirst(a) },
  },
}));
jest.mock("@/lib/authenticate", () => ({ authenticateRequest: () => mockAuthenticate() }));
jest.mock("@/lib/media/loadImage", () => ({ loadImage: jest.fn() }));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));
jest.mock("@/lib/media/proxyImage", () => ({
  imageDimension: (raw: string | null, d: number) => (raw ? Number(raw) : d),
  resizeImage: jest.fn(async (buf: Buffer) => buf),
}));

import { GET as shareGET } from "@/app/api/share/[token]/artwork/route";
import { GET as ownGET } from "@/app/api/campaigns/[id]/thumbnail/route";

const share = (token: string) =>
  shareGET(new NextRequest(`http://localhost/api/share/${token}/artwork?v=1&w=384`), {
    params: Promise.resolve({ token }),
  });
const own = (id: string) =>
  ownGET(new NextRequest(`http://localhost/api/campaigns/${id}/thumbnail?v=1&w=64`), { params: Promise.resolve({ id }) });

beforeEach(() => jest.clearAllMocks());

describe("GET /api/share/[token]/artwork", () => {
  it("serves the link's own campaign's picture as a cacheable WebP", async () => {
    const res = await share("tok-a");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
  });

  it("never serves a copy of a picture the campaign has moved off", async () => {
    expect((await share("tok-moved")).status).toBe(404);
  });

  it("answers 404 for a revoked link, another kind of link, no campaign, or an unknown token", async () => {
    expect((await share("tok-revoked")).status).toBe(404);
    expect((await share("tok-other-kind")).status).toBe(404);
    expect((await share("tok-no-campaign")).status).toBe(404);
    expect((await share("nope")).status).toBe(404);
  });

  it("never reaches another org's picture", async () => {
    expect((await share("tok-crossed")).status).toBe(404);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

describe("GET /api/campaigns/[id]/thumbnail", () => {
  it("needs a session", async () => {
    mockAuthenticate.mockResolvedValue(null);
    expect((await own("camp-a")).status).toBe(401);
  });

  it("serves a picture in the caller's org and nobody else's, and only the current one", async () => {
    mockAuthenticate.mockResolvedValue({ orgId: "org-1" });
    expect((await own("camp-a")).status).toBe(200);
    expect((await own("camp-x")).status).toBe(404);
    expect((await own("camp-moved")).status).toBe(404);
  });
});
