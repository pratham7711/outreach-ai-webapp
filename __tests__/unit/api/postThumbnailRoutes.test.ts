/**
 * @jest-environment node
 *
 * Who may see a stored post picture.
 *
 * The share route answers anyone holding a link, so a link for one campaign
 * must not reach another campaign's picture by guessing its post id. The
 * dashboard route answers a session, so it must hold to the session's org and,
 * for an "assigned campaigns only" seat, to those campaigns.
 *
 * The database here is a small in-memory one that evaluates the same `where`
 * the routes build, rather than a mock that checks the call: what is asserted
 * is the answer a caller gets, so a filter dropped from the query fails the
 * test even if the call still "looks" right.
 */
import { NextRequest } from "next/server";

type PostRow = { id: string; campaignId: string; orgId: string; platform: string; team: string[]; removedAt?: Date };
type ThumbRow = { postId: string; orgId: string; data: Uint8Array | null; fetchedAt: Date | null };

const POSTS: PostRow[] = [
  { id: "a-ig", campaignId: "camp-a", orgId: "org-1", platform: "INSTAGRAM", team: ["u-assigned"] },
  { id: "a-tt", campaignId: "camp-a", orgId: "org-1", platform: "TIKTOK", team: ["u-assigned"] },
  { id: "b-ig", campaignId: "camp-b", orgId: "org-1", platform: "INSTAGRAM", team: [] },
  { id: "a-removed", campaignId: "camp-a", orgId: "org-1", platform: "INSTAGRAM", team: [], removedAt: new Date(2000) },
  { id: "x-ig", campaignId: "camp-x", orgId: "org-2", platform: "INSTAGRAM", team: [] },
];
const THUMBS: ThumbRow[] = [
  ...POSTS.map((p) => ({ postId: p.id, orgId: p.orgId, data: new Uint8Array([1, 2, 3]), fetchedAt: new Date(1000) })),
  { postId: "failed-only", orgId: "org-1", data: null, fetchedAt: null },
];

/* Just enough of Prisma's filter language to run what the routes ask. */
function matchesCampaign(post: PostRow, where: Record<string, any>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "orgId" && post.orgId !== v) return false;
    else if (k === "OR") {
      if (!(v as Record<string, any>[]).some((alt) => matchesCampaign(post, alt))) return false;
    } else if (k === "teamMembers") {
      if (!post.team.includes(v.some.userId)) return false;
    } else if (k === "createdById") {
      return false;
    } else if (!["orgId", "OR", "teamMembers", "createdById"].includes(k)) throw new Error(`unmodelled campaign filter ${k}`);
  }
  return true;
}
function matchesPost(post: PostRow, where: Record<string, any>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === "campaignId") {
      if (post.campaignId !== v) return false;
    } else if (k === "platform") {
      if (!v.in.includes(post.platform)) return false;
    } else if (k === "campaign") {
      if (!matchesCampaign(post, v)) return false;
    } else if (k === "removedAt" && v === null) {
      if (post.removedAt) return false;
    } else throw new Error(`unmodelled post filter ${k}`);
  }
  return true;
}
const mockFindFirst = jest.fn(async ({ where }: { where: Record<string, any> }) => {
  const row = THUMBS.find(
    (t) =>
      t.postId === where.postId &&
      t.orgId === where.orgId &&
      (!where.data || t.data !== null) &&
      (!where.post || matchesPost(POSTS.find((p) => p.id === t.postId)!, where.post))
  );
  return row ? { data: row.data, fetchedAt: row.fetchedAt } : null;
});

const mockReport = jest.fn();
const mockAuth = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    report: { findUnique: (...a: unknown[]) => mockReport(...a) },
    postThumbnail: { findFirst: (a: { where: Record<string, any> }) => mockFindFirst(a) },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: () => mockAuth() }));
jest.mock("@/lib/media/loadImage", () => ({ loadImage: jest.fn() }));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));
jest.mock("@/lib/media/proxyImage", () => ({
  imageDimension: (raw: string | null, d: number) => (raw ? Number(raw) : d),
  resizeImage: jest.fn(async (buf: Buffer) => buf),
}));

import { GET as shareGET } from "@/app/api/share/[token]/thumbnail/[postId]/route";
import { GET as ownGET } from "@/app/api/posts/[id]/thumbnail/route";

const links: Record<string, Record<string, unknown> | null> = {
  "tok-a": { isPublic: true, orgId: "org-1", campaignId: "camp-a", config: { kind: "campaign-performance", visibility: { showCreators: true } } },
  "tok-b": { isPublic: true, orgId: "org-1", campaignId: "camp-b", config: { kind: "campaign-performance", visibility: { showCreators: true } } },
  "tok-a-ig-only": {
    isPublic: true,
    orgId: "org-1",
    campaignId: "camp-a",
    config: { kind: "campaign-performance", visibility: { showCreators: true, platforms: ["INSTAGRAM"] } },
  },
  "tok-a-hidden": { isPublic: true, orgId: "org-1", campaignId: "camp-a", config: { kind: "campaign-performance", visibility: { showCreators: false } } },
  "tok-a-revoked": { isPublic: false, orgId: "org-1", campaignId: "camp-a", config: { kind: "campaign-performance", visibility: { showCreators: true } } },
  "tok-other-kind": { isPublic: true, orgId: "org-1", campaignId: "camp-a", config: { kind: "roster", visibility: { showCreators: true } } },
};

const share = (token: string, postId: string, qs = "") =>
  shareGET(new NextRequest(`http://localhost/api/share/${token}/thumbnail/${postId}${qs}`), {
    params: Promise.resolve({ token, postId }),
  });
const own = (id: string) =>
  ownGET(new NextRequest(`http://localhost/api/posts/${id}/thumbnail?w=320&h=568`), { params: Promise.resolve({ id }) });
const user = (over: Record<string, unknown> = {}) => ({ user: { id: "u-1", orgId: "org-1", role: "OWNER", ...over } });

beforeEach(() => {
  jest.clearAllMocks();
  mockReport.mockImplementation(async ({ where }: { where: { shareToken: string } }) => links[where.shareToken] ?? null);
});

describe("GET /api/share/[token]/thumbnail/[postId]", () => {
  it("serves a picture of a post on the link's own campaign, as a cacheable WebP", async () => {
    const res = await share("tok-a", "a-ig", "?w=478&h=490");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(res.headers.get("Last-Modified")).toBe(new Date(1000).toUTCString());
  });

  it("gives campaign A's link a 404 for campaign B's picture, and the reverse", async () => {
    expect((await share("tok-a", "b-ig")).status).toBe(404);
    expect((await share("tok-b", "a-ig")).status).toBe(404);
    expect((await share("tok-b", "b-ig")).status).toBe(200);
  });

  it("gives a post removed from the campaign a 404, though its copy is held", async () => {
    expect((await share("tok-a", "a-removed")).status).toBe(404);
  });

  it("never reaches another org's picture, whatever the id", async () => {
    expect((await share("tok-a", "x-ig")).status).toBe(404);
  });

  it("holds a platform-filtered link to the platforms its report lists", async () => {
    expect((await share("tok-a-ig-only", "a-ig")).status).toBe(200);
    expect((await share("tok-a-ig-only", "a-tt")).status).toBe(404);
  });

  it("shows nothing on a link that hides creators, a revoked link, another kind of link, or no link", async () => {
    for (const token of ["tok-a-hidden", "tok-a-revoked", "tok-other-kind", "no-such-token"]) {
      expect((await share(token, "a-ig")).status).toBe(404);
    }
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("answers a post with no held copy with a cached 404, so the card shows its placeholder", async () => {
    const res = await share("tok-a", "failed-only");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
  });
});

describe("GET /api/posts/[id]/thumbnail", () => {
  it("needs a session", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await own("a-ig")).status).toBe(401);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("serves the session org's picture and nothing from another org", async () => {
    mockAuth.mockResolvedValue(user());
    expect((await own("a-ig")).status).toBe(200);
    expect((await own("b-ig")).status).toBe(200);
    expect((await own("x-ig")).status).toBe(404);
  });

  it("holds an assigned-campaigns seat to its own campaigns", async () => {
    mockAuth.mockResolvedValue(user({ id: "u-assigned", role: "MEMBER", campaignScope: "ASSIGNED" }));
    expect((await own("a-ig")).status).toBe(200);
    expect((await own("b-ig")).status).toBe(404);
  });

  it("keeps the unscoped lookup to the org and the post id, with no campaign join", async () => {
    mockAuth.mockResolvedValue(user());
    await own("a-ig");
    expect(mockFindFirst.mock.calls[0][0].where).toEqual({ postId: "a-ig", orgId: "org-1", data: { not: null } });
  });
});
