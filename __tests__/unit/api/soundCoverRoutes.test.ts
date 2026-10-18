/**
 * @jest-environment node
 *
 * Who may see a stored sound cover.
 *
 * The share route answers anyone holding a link and names no sound, so a link
 * can only ever reach the cover of its own campaign's sound. The dashboard
 * route answers a session and holds to the session's org.
 *
 * The database is a small in-memory one that evaluates the `where` the routes
 * build, so a filter dropped from a query fails here even if the call still
 * looks right.
 */
import { NextRequest } from "next/server";

type CoverRow = { soundId: string; orgId: string; data: Uint8Array | null; fetchedAt: Date | null };
const COVERS: CoverRow[] = [
  { soundId: "sound-a", orgId: "org-1", data: new Uint8Array([1, 2, 3]), fetchedAt: new Date(1000) },
  { soundId: "sound-x", orgId: "org-2", data: new Uint8Array([4, 5, 6]), fetchedAt: new Date(2000) },
  { soundId: "sound-failed", orgId: "org-1", data: null, fetchedAt: null },
];

type CoverWhere = { soundId: string; orgId: string; data?: { not: null } };
const mockFindFirst = jest.fn(async ({ where }: { where: CoverWhere }) => {
  const row = COVERS.find(
    (c) => c.soundId === where.soundId && c.orgId === where.orgId && (!where.data || c.data !== null)
  );
  return row ? { data: row.data, fetchedAt: row.fetchedAt } : null;
});

const campaign = (soundId: string | null, orgId = "org-1") => ({ orgId, song: soundId ? { soundId } : null });
const links: Record<string, Record<string, unknown>> = {
  "tok-a": { isPublic: true, orgId: "org-1", config: { kind: "campaign-performance" }, campaign: campaign("sound-a") },
  "tok-revoked": { isPublic: false, orgId: "org-1", config: { kind: "campaign-performance" }, campaign: campaign("sound-a") },
  "tok-other-kind": { isPublic: true, orgId: "org-1", config: { kind: "roster" }, campaign: campaign("sound-a") },
  "tok-no-sound": { isPublic: true, orgId: "org-1", config: { kind: "campaign-performance" }, campaign: campaign(null) },
  "tok-no-copy": { isPublic: true, orgId: "org-1", config: { kind: "campaign-performance" }, campaign: campaign("sound-failed") },
  // A link whose row and campaign disagree on the tenant answers nothing.
  "tok-crossed": { isPublic: true, orgId: "org-1", config: { kind: "campaign-performance" }, campaign: campaign("sound-x", "org-2") },
};

const mockAuthenticate = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    report: {
      findUnique: async ({ where }: { where: { shareToken: string } }) => links[where.shareToken] ?? null,
    },
    soundCover: { findFirst: (a: { where: CoverWhere }) => mockFindFirst(a) },
  },
}));
jest.mock("@/lib/authenticate", () => ({ authenticateRequest: () => mockAuthenticate() }));
jest.mock("@/lib/media/loadImage", () => ({ loadImage: jest.fn() }));
jest.mock("@/lib/platforms/creatorProfile", () => ({ readCreatorProfile: jest.fn() }));
jest.mock("@/lib/media/proxyImage", () => ({
  imageDimension: (raw: string | null, d: number) => (raw ? Number(raw) : d),
  resizeImage: jest.fn(async (buf: Buffer) => buf),
}));

import { GET as shareGET } from "@/app/api/share/[token]/sound-cover/route";
import { GET as ownGET } from "@/app/api/sounds/[id]/cover/route";

const share = (token: string) =>
  shareGET(new NextRequest(`http://localhost/api/share/${token}/sound-cover?v=1&w=384`), {
    params: Promise.resolve({ token }),
  });
const own = (id: string) =>
  ownGET(new NextRequest(`http://localhost/api/sounds/${id}/cover?v=1&w=96`), { params: Promise.resolve({ id }) });

beforeEach(() => jest.clearAllMocks());

describe("GET /api/share/[token]/sound-cover", () => {
  it("serves the link's own campaign's cover as a cacheable WebP", async () => {
    const res = await share("tok-a");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]));
  });

  it("answers 404 for a revoked link, another kind of link, or an unknown token", async () => {
    expect((await share("tok-revoked")).status).toBe(404);
    expect((await share("tok-other-kind")).status).toBe(404);
    expect((await share("nope")).status).toBe(404);
  });

  it("answers 404 when the campaign has no sound, or the sound no copy", async () => {
    expect((await share("tok-no-sound")).status).toBe(404);
    expect((await share("tok-no-copy")).status).toBe(404);
  });

  it("never reaches another org's cover", async () => {
    expect((await share("tok-crossed")).status).toBe(404);
    expect(mockFindFirst).not.toHaveBeenCalled();
  });
});

describe("GET /api/sounds/[id]/cover", () => {
  it("needs a session", async () => {
    mockAuthenticate.mockResolvedValue(null);
    expect((await own("sound-a")).status).toBe(401);
  });

  it("serves a cover in the caller's org and nobody else's", async () => {
    mockAuthenticate.mockResolvedValue({ orgId: "org-1" });
    expect((await own("sound-a")).status).toBe(200);
    expect((await own("sound-x")).status).toBe(404);
    expect((await own("sound-failed")).status).toBe(404);
  });
});
