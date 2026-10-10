/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    feedback: { create: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    report: { findUnique: jest.fn() },
    organization: { findMany: jest.fn() },
    creatorUser: { findMany: jest.fn() },
  },
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/lists/listShare", () => ({ loadListShare: jest.fn() }));
jest.mock("@/lib/feedback/feedbackTables", () => ({ feedbackTablesReady: jest.fn() }));

import { POST } from "@/app/api/feedback/route";
import * as platform from "@/app/api/platform/feedback/route";
import { GET as screenshot } from "@/app/api/platform/feedback/[id]/screenshot/route";
import { cleanContext, cleanPageUrl, decodeScreenshot, MAX_SCREENSHOT_BYTES } from "@/lib/feedback/submission";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getCreatorSession } from "@/lib/creator-auth";
import { loadListShare } from "@/lib/lists/listShare";
import { feedbackTablesReady } from "@/lib/feedback/feedbackTables";

const mdb = db as unknown as Record<string, Record<string, jest.Mock>>;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const jpegDataUrl = `data:image/jpeg;base64,${JPEG.toString("base64")}`;

let ip = 0;
const post = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/feedback", {
      method: "POST",
      headers: { "x-real-ip": `10.0.0.${++ip}` },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const valid = (over: Record<string, unknown> = {}) => ({
  surface: "dashboard",
  pageUrl: "https://campaign.madeboring.com/campaigns/c1#posts",
  pageTitle: "Campaign",
  message: "  numbers look stale  ",
  screenshot: jpegDataUrl,
  context: { viewport: { w: 1440, h: 900, dpr: 2 }, errors: [{ at: "t", kind: "error", message: "boom" }] },
  ...over,
});
const created = () => mdb.feedback.create.mock.calls[0][0].data;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.FEEDBACK_RATE_LIMIT_PER_10_MIN;
  (auth as jest.Mock).mockResolvedValue(null);
  (getCreatorSession as jest.Mock).mockResolvedValue(null);
  (loadListShare as jest.Mock).mockResolvedValue(null);
  (feedbackTablesReady as jest.Mock).mockResolvedValue(true);
  mdb.feedback.create.mockResolvedValue({ id: "fb1" });
  mdb.report.findUnique.mockResolvedValue(null);
});

describe("decodeScreenshot", () => {
  it("accepts a JPEG data URL whose bytes are a JPEG", () => {
    const out = decodeScreenshot(jpegDataUrl);
    expect("bytes" in out && out.type).toBe("image/jpeg");
  });

  it("refuses other types, mislabelled bytes, empty and oversized images", () => {
    expect(decodeScreenshot("data:image/gif;base64,R0lGOD")).toEqual({ error: "unsupported type image/gif" });
    expect(decodeScreenshot("data:image/svg+xml;base64,PHN2Zz4=")).toEqual({ error: "not an image data URL" });
    expect(decodeScreenshot(`data:image/png;base64,${JPEG.toString("base64")}`)).toEqual({
      error: "bytes are not the declared image type",
    });
    expect(decodeScreenshot("https://example.com/a.jpg")).toEqual({ error: "not an image data URL" });
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_SCREENSHOT_BYTES)]);
    expect(decodeScreenshot(`data:image/jpeg;base64,${big.toString("base64")}`)).toEqual({ error: "image too large" });
  });
});

describe("cleanContext and cleanPageUrl", () => {
  it("keeps only the known fields, capped, and the last 20 signals", () => {
    const out = cleanContext({
      viewport: { w: 1440, h: 900, dpr: 2, extra: 1 },
      userAgent: "x".repeat(1000),
      cookie: "secret",
      errors: Array.from({ length: 30 }, (_, i) => ({ at: String(i), kind: "error", message: "m".repeat(900) })),
    });
    expect(out).not.toHaveProperty("cookie");
    expect(out.viewport).toEqual({ w: 1440, h: 900, dpr: 2 });
    expect(out.userAgent).toHaveLength(400);
    expect(out.errors).toHaveLength(20);
    expect(out.errors[0].at).toBe("10");
    expect(out.errors[0].message).toHaveLength(500);
    expect(cleanContext("junk")).toMatchObject({ errors: [], failedRequests: [] });
  });

  it("stores http(s) addresses without the fragment and refuses anything else", () => {
    expect(cleanPageUrl("https://a.test/x?y=1#frag")).toBe("https://a.test/x?y=1");
    expect(cleanPageUrl("javascript:alert(1)")).toBeNull();
    expect(cleanPageUrl("not a url")).toBeNull();
  });
});

describe("POST /api/feedback", () => {
  it("stores a signed-in user's feedback with the screenshot, the org from the session and the trimmed message", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1", email: "a@agency.test" } });
    const res = await post(valid({ orgId: "someone-elses-org" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "fb1" });
    const data = created();
    expect(data).toMatchObject({
      surface: "dashboard",
      orgId: "org-1",
      userId: "u1",
      userEmail: "a@agency.test",
      creatorUserId: null,
      linkToken: null,
      message: "numbers look stale",
      pageUrl: "https://campaign.madeboring.com/campaigns/c1",
      screenshotType: "image/jpeg",
      screenshotError: null,
    });
    expect(Buffer.from(data.screenshot)).toEqual(JPEG);
    expect(data.context).toMatchObject({ sender: "user", viewport: { w: 1440 }, errors: [{ message: "boom" }] });
  });

  it("files a portal creator under the creator, with no org", async () => {
    (getCreatorSession as jest.Mock).mockResolvedValue({ creatorUserId: "cu1" });
    expect((await post(valid({ surface: "portal" }))).status).toBe(201);
    expect(created()).toMatchObject({ creatorUserId: "cu1", orgId: null, userId: null, userEmail: null });
  });

  it("takes a share-link client's org from the live link, and refuses a revoked one", async () => {
    mdb.report.findUnique.mockResolvedValue({ isPublic: true, campaign: { orgId: "org-9" } });
    expect((await post(valid({ surface: "share", linkToken: "tok" }))).status).toBe(201);
    expect(created()).toMatchObject({ orgId: "org-9", linkToken: "tok", userId: null });
    expect(mdb.report.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { shareToken: "tok" } }));

    jest.clearAllMocks();
    mdb.report.findUnique.mockResolvedValue({ isPublic: false, campaign: { orgId: "org-9" } });
    expect((await post(valid({ surface: "share", linkToken: "tok" }))).status).toBe(401);
    expect(mdb.feedback.create).not.toHaveBeenCalled();
  });

  it("takes a list-link client's org from the live list share", async () => {
    (loadListShare as jest.Mock).mockResolvedValue({ orgId: "org-5" });
    expect((await post(valid({ surface: "list", linkToken: "lt" }))).status).toBe(201);
    expect(created()).toMatchObject({ orgId: "org-5", linkToken: "lt" });
  });

  it("refuses anyone with no session and no link, and a dashboard body naming a token", async () => {
    expect((await post(valid())).status).toBe(401);
    mdb.report.findUnique.mockResolvedValue({ isPublic: true, campaign: { orgId: "org-9" } });
    expect((await post(valid({ linkToken: "tok" }))).status).toBe(401);
    expect(mdb.feedback.create).not.toHaveBeenCalled();
  });

  it("keeps the message when the screenshot is refused, and says why", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1" } });
    expect((await post(valid({ screenshot: "data:image/gif;base64,R0lGOD" }))).status).toBe(201);
    expect(created()).toMatchObject({ screenshot: null, screenshotType: null, screenshotError: "refused: unsupported type image/gif" });
  });

  it("records the browser's reason when no screenshot could be taken", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1" } });
    await post(valid({ screenshot: undefined, screenshotError: "SecurityError: tainted canvas" }));
    expect(created()).toMatchObject({ screenshot: null, screenshotError: "SecurityError: tainted canvas" });
  });

  it("answers 400 to a malformed body or page address", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1" } });
    expect((await post("{nope")).status).toBe(400);
    expect((await post(valid({ surface: "admin" }))).status).toBe(400);
    expect((await post(valid({ pageUrl: "javascript:alert(1)" }))).status).toBe(400);
    expect(mdb.feedback.create).not.toHaveBeenCalled();
  });

  it("answers 503 while the table does not exist", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1" } });
    (feedbackTablesReady as jest.Mock).mockResolvedValue(false);
    expect((await post(valid())).status).toBe(503);
    expect(mdb.feedback.create).not.toHaveBeenCalled();
  });

  it("rate-limits one address", async () => {
    (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1" } });
    process.env.FEEDBACK_RATE_LIMIT_PER_10_MIN = "2";
    const same = () =>
      POST(new NextRequest("http://localhost/api/feedback", { method: "POST", headers: { "x-real-ip": "10.9.9.9" }, body: JSON.stringify(valid()) }));
    expect((await same()).status).toBe(201);
    expect((await same()).status).toBe(201);
    const third = await same();
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("the operator's inbox routes", () => {
  const savedAdmins = process.env.PLATFORM_ADMIN_EMAILS;
  beforeAll(() => {
    process.env.PLATFORM_ADMIN_EMAILS = "ops@platform.test";
  });
  afterAll(() => {
    process.env.PLATFORM_ADMIN_EMAILS = savedAdmins;
  });
  const asOperator = () => (auth as jest.Mock).mockResolvedValue({ user: { id: "op", email: "ops@platform.test" } });
  const asAgency = () => (auth as jest.Mock).mockResolvedValue({ user: { id: "u1", orgId: "org-1", email: "a@agency.test" } });
  const get = (q = "") => platform.GET(new NextRequest(`http://localhost/api/platform/feedback${q}`));
  const patch = (body: unknown) =>
    platform.PATCH(new NextRequest("http://localhost/api/platform/feedback", { method: "PATCH", body: JSON.stringify(body) }));
  const shot = (id: string) => screenshot(new NextRequest(`http://localhost/x`), { params: Promise.resolve({ id }) });

  it("are 404 for an agency user and for no session, and read nothing", async () => {
    asAgency();
    expect((await get()).status).toBe(404);
    expect((await patch({ id: "fb1", resolved: true })).status).toBe(404);
    expect((await shot("fb1")).status).toBe(404);
    (auth as jest.Mock).mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(mdb.feedback.findMany).not.toHaveBeenCalled();
    expect(mdb.feedback.updateMany).not.toHaveBeenCalled();
    expect(mdb.feedback.findUnique).not.toHaveBeenCalled();
  });

  it("lists open feedback with the sender spelled out and no screenshot bytes", async () => {
    asOperator();
    mdb.feedback.findMany.mockResolvedValue([
      {
        id: "fb1",
        createdAt: new Date("2026-10-11T10:00:00Z"),
        surface: "share",
        orgId: "org-9",
        userEmail: null,
        creatorUserId: null,
        linkToken: "tok",
        message: "hi",
        pageUrl: "https://x.test/share/tok",
        pageTitle: null,
        screenshotType: "image/jpeg",
        screenshotError: null,
        context: {},
        resolvedAt: null,
        resolvedBy: null,
      },
    ]);
    mdb.feedback.count.mockResolvedValue(1);
    mdb.organization.findMany.mockResolvedValue([{ id: "org-9", name: "LKay" }]);
    const body = await (await get("?status=open")).json();
    expect(body.ready).toBe(true);
    expect(body.open).toBe(1);
    expect(body.rows[0]).toMatchObject({ id: "fb1", orgName: "LKay", fromLink: true, hasScreenshot: true });
    expect(body.rows[0]).not.toHaveProperty("screenshot");
    const select = mdb.feedback.findMany.mock.calls[0][0].select;
    expect(select.screenshot).toBeUndefined();
    expect(mdb.feedback.findMany.mock.calls[0][0].where).toEqual({ resolvedAt: null });
  });

  it("resolves and reopens, recording who resolved it", async () => {
    asOperator();
    mdb.feedback.updateMany.mockResolvedValue({ count: 1 });
    expect((await patch({ id: "fb1", resolved: true })).status).toBe(200);
    expect(mdb.feedback.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "fb1" },
      data: { resolvedBy: "ops@platform.test" },
    });
    expect((await patch({ id: "fb1", resolved: false })).status).toBe(200);
    expect(mdb.feedback.updateMany.mock.calls[1][0].data).toEqual({ resolvedAt: null, resolvedBy: null });
    mdb.feedback.updateMany.mockResolvedValue({ count: 0 });
    expect((await patch({ id: "gone", resolved: true })).status).toBe(404);
    expect((await patch({ id: 1 })).status).toBe(400);
  });

  it("serves the stored screenshot with its type and no sniffing", async () => {
    asOperator();
    mdb.feedback.findUnique.mockResolvedValue({ screenshot: new Uint8Array(JPEG), screenshotType: "image/jpeg" });
    const res = await shot("fb1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(JPEG);
    mdb.feedback.findUnique.mockResolvedValue({ screenshot: null, screenshotType: null });
    expect((await shot("fb2")).status).toBe(404);
  });
});
