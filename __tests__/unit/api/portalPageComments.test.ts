/**
 * @jest-environment node
 *
 * GET /api/portal/insights/comments: the Page owner reads the comments on one
 * of their own Facebook Page posts from My stats (pages_read_user_content).
 * Only a post on the Page their own connection administers is read, and the
 * answer is never cached or stored.
 */
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));
jest.mock("@/lib/portal/creatorLink", () => ({ findLinkedCreatorsForHandle: jest.fn() }));
jest.mock("@/lib/creators/connectionGate", () => ({ connectionForRead: jest.fn() }));
jest.mock("@/lib/platforms/instagramToken", () => ({ ensureFreshInstagramToken: jest.fn() }));
jest.mock("@/lib/platforms/facebookPage", () => ({
  fetchFacebookPage: jest.fn(),
  fetchFacebookPostComments: jest.fn(),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/portal/insights/comments/route";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { connectionForRead } from "@/lib/creators/connectionGate";
import { ensureFreshInstagramToken } from "@/lib/platforms/instagramToken";
import { fetchFacebookPage, fetchFacebookPostComments } from "@/lib/platforms/facebookPage";
import { InstagramAuthError } from "@/lib/platforms/instagram";

const session = { id: "s-1", creatorUserId: "cu-1", email: "c@example.test", name: "Fake Creator", handle: "fake_creator_one" };
const connection = { id: "acc-1", creatorId: "cr-1", platform: "FACEBOOK", handle: "Fake Page", accessToken: "enc", tokenExpiry: null };
const page = { pageId: "111", pageAccessToken: "page-token", displayName: "Fake Page" };
const comments = {
  total: 2,
  preview: [
    { id: "c1", message: "Where can I buy this?", authorName: "A Commenter", createdAt: "2026-10-20T10:00:00+0000", likeCount: 1 },
    { id: "c2", message: "Love it", authorName: null, createdAt: "2026-10-20T11:00:00+0000", likeCount: 0 },
  ],
};

const read = (post: string) =>
  GET(new NextRequest(`https://campaign.example.com/api/portal/insights/comments?post=${encodeURIComponent(post)}`));

beforeEach(() => {
  jest.clearAllMocks();
  (getCreatorSession as jest.Mock).mockResolvedValue(session);
  (findLinkedCreatorsForHandle as jest.Mock).mockResolvedValue([{ id: "cr-1", orgId: "org-1" }]);
  (connectionForRead as jest.Mock).mockResolvedValue({ ok: true, connection, grantId: "g-1" });
  (ensureFreshInstagramToken as jest.Mock).mockResolvedValue("user-token");
  (fetchFacebookPage as jest.Mock).mockResolvedValue(page);
  (fetchFacebookPostComments as jest.Mock).mockResolvedValue(comments);
});

describe("GET /api/portal/insights/comments", () => {
  it("401s without a creator session and reads nothing", async () => {
    (getCreatorSession as jest.Mock).mockResolvedValue(null);
    expect((await read("111_222")).status).toBe(401);
    expect(fetchFacebookPostComments).not.toHaveBeenCalled();
  });

  it("refuses an id that is not a Page post id", async () => {
    const res = await read("../me/accounts");
    expect(res.status).toBe(400);
    expect(fetchFacebookPostComments).not.toHaveBeenCalled();
  });

  it("returns the comments on the creator's own Page post, uncached and marked not stored", async () => {
    const res = await read("111_222");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ total: 2, pageName: "Fake Page", stored: false });
    expect(body.preview).toHaveLength(2);
    expect(connectionForRead).toHaveBeenCalledWith("org-1", "cr-1", "FACEBOOK", { order: "newest" });
    expect(fetchFacebookPostComments).toHaveBeenCalledWith("111_222", "page-token");
  });

  it("will not read a post on a Page the creator did not connect", async () => {
    const res = await read("999_222");
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_your_post");
    expect(fetchFacebookPostComments).not.toHaveBeenCalled();
  });

  it("asks the creator to connect a Page when there is no Facebook connection", async () => {
    (connectionForRead as jest.Mock).mockResolvedValue({ ok: false, unknown: "no_connection" });
    const res = await read("111_222");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_connection");
  });

  it("asks for a reconnect when the token has lapsed or Facebook rejects it", async () => {
    (ensureFreshInstagramToken as jest.Mock).mockResolvedValueOnce(undefined);
    expect((await (await read("111_222")).json()).error).toBe("reauthorize");

    (fetchFacebookPostComments as jest.Mock).mockRejectedValueOnce(new InstagramAuthError(400, 190, "Error validating access token"));
    const res = await read("111_222");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("reauthorize");
  });

  it("says Facebook did not answer rather than showing an empty list", async () => {
    (fetchFacebookPostComments as jest.Mock).mockResolvedValue(null);
    const res = await read("111_222");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("unreadable");
  });
});
