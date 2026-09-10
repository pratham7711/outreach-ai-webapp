import { fetchFacebookPostComments } from "@/lib/platforms/facebookPage";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("fetchFacebookPostComments", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("asks the comments edge itself, not the summary field expansion", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse({ data: [], summary: { total_count: 0 } }),
    );
    global.fetch = fetchMock;

    await fetchFacebookPostComments("1122_3344", "page-token");

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    /* The whole point of this function. `comments.summary(true).limit(0)` as a
       field on the post is credited to pages_read_engagement, which is why the
       pages_read_user_content testing counter stayed at zero while the app
       looked like it was reading comments. */
    expect(url.pathname).toContain("/1122_3344/comments");
    expect(url.searchParams.get("fields")).toContain("message");
    /* Top-level only: replies live on each comment's own edge, and counting
       them under a heading that says "comments" would not match Facebook. */
    expect(url.searchParams.get("filter")).toBe("toplevel");
    expect(url.searchParams.get("summary")).toBe("true");
  });

  it("reports the edge's total, not the number of previewed comments", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        data: [
          { id: "c1", message: "first", created_time: "2026-09-01T10:00:00+0000" },
          { id: "c2", message: "second", created_time: "2026-09-01T11:00:00+0000" },
        ],
        summary: { total_count: 412 },
      }),
    );

    const result = await fetchFacebookPostComments("p1", "page-token");
    /* A preview capped at five must never become the count. A post with 412
       comments reporting "2" is the failure this asserts against. */
    expect(result?.total).toBe(412);
    expect(result?.preview).toHaveLength(2);
  });

  it("leaves the total null when Facebook returns no summary", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ data: [{ id: "c1", message: "hi" }] }),
    );
    const result = await fetchFacebookPostComments("p1", "page-token");
    /* Not 0, and not 1. "Facebook did not say" is its own state, and the screen
       renders it as an em dash. */
    expect(result?.total).toBeNull();
  });

  it("treats a comment with no author as ordinary, not as a failure", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        data: [{ id: "c1", message: "no from field here" }],
        summary: { total_count: 1 },
      }),
    );
    const result = await fetchFacebookPostComments("p1", "page-token");
    /* Facebook omits `from` for any commenter who has not authorised the app,
       which since 2018 is nearly everyone. */
    expect(result?.preview[0]).toEqual({
      id: "c1",
      message: "no from field here",
      authorName: null,
      createdAt: null,
      likeCount: null,
    });
  });

  it("distinguishes an unreadable edge from a post with no comments", async () => {
    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ error: { code: 10 } }, false, 403));
    /* graphGet throws InstagramAuthError on 403 — the caller turns that into a
       reconnect prompt. What must never happen is a resolved empty list, which
       would render as "nobody has commented". */
    await expect(fetchFacebookPostComments("p1", "page-token")).rejects.toThrow();

    global.fetch = jest.fn().mockResolvedValue(jsonResponse({ error: { code: 1 } }, false, 500));
    await expect(fetchFacebookPostComments("p1", "page-token")).resolves.toBeNull();

    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({ data: [], summary: { total_count: 0 } }),
    );
    await expect(fetchFacebookPostComments("p1", "page-token")).resolves.toEqual({
      total: 0,
      preview: [],
    });
  });

  it("returns only the fields the screen renders, and no token", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "c1",
            message: "nice",
            created_time: "2026-09-01T10:00:00+0000",
            like_count: 3,
            from: { name: "A Person", id: "should-not-surface" },
          },
        ],
        summary: { total_count: 1 },
      }),
    );
    const result = await fetchFacebookPostComments("p1", "page-token");
    /* The commenter's id is deliberately dropped: it identifies a third party
       who never agreed to be in our system, and nothing on the screen needs it.
       Asserted on the exact shape so adding a field is a deliberate act. */
    expect(Object.keys(result!.preview[0]).sort()).toEqual([
      "authorName",
      "createdAt",
      "id",
      "likeCount",
      "message",
    ]);
  });
});
