/**
 * @jest-environment node
 */
import { errandQuery, landingAfterAuth, readAuthErrand } from "@/lib/portal/afterAuth";
import { splitLinks } from "@/lib/portal/postLinks";

const params = (q: string) => new URLSearchParams(q);

function mockFetch(status: number, body: unknown) {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("readAuthErrand / errandQuery", () => {
  it("carries an invitation to the other auth page", () => {
    expect(errandQuery(readAuthErrand(params("invitation=abc123")))).toBe("?invitation=abc123");
  });

  it("keeps the pinned join-with-code link intact", () => {
    expect(errandQuery(readAuthErrand(params("join=summer-drop&invite=CODE1")))).toBe(
      "?join=summer-drop&invite=CODE1",
    );
  });

  it("drops a stray invite code that has no campaign to join", () => {
    expect(errandQuery(readAuthErrand(params("invite=CODE1")))).toBe("");
  });

  it("is empty with no errand", () => {
    expect(errandQuery(readAuthErrand(params("")))).toBe("");
  });

  it("carries a connect link to the other auth page", () => {
    expect(errandQuery(readAuthErrand(params("connect=tokABC")))).toBe("?connect=tokABC");
  });
});

describe("landingAfterAuth", () => {
  const none = { invitation: null, join: null, invite: null, connect: null };

  it("goes to the fallback with no errand, and calls nothing", async () => {
    const fetchMock = mockFetch(200, {});
    await expect(landingAfterAuth(none, "/portal/dashboard")).resolves.toBe("/portal/dashboard");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts an invitation and lands on the campaign", async () => {
    const fetchMock = mockFetch(201, { campaignPath: "/portal/campaigns/camp1" });
    await expect(landingAfterAuth({ ...none, invitation: "tok123" }, "/x")).resolves.toBe(
      "/portal/campaigns/camp1?accepted=1",
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/portal/invites/tok123/accept", { method: "POST" });
  });

  it("sends a refused invitation back to its landing page", async () => {
    mockFetch(409, { error: "closed" });
    await expect(landingAfterAuth({ ...none, invitation: "tok123" }, "/x")).resolves.toBe("/invite/tok123");
  });

  it("sends a network failure back to the landing page too", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    await expect(landingAfterAuth({ ...none, invitation: "tok123" }, "/x")).resolves.toBe("/invite/tok123");
  });

  it("joins a marketplace campaign with the invite code", async () => {
    const fetchMock = mockFetch(201, {});
    await expect(landingAfterAuth({ ...none, join: "summer-drop", invite: "CODE1" }, "/x")).resolves.toBe(
      "/portal/campaigns/summer-drop?joined=1",
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ slug: "summer-drop", inviteCode: "CODE1" });
  });

  it("shows a refused join on the campaign page", async () => {
    mockFetch(403, { error: "Invite only" });
    await expect(landingAfterAuth({ ...none, join: "summer-drop" }, "/x")).resolves.toBe(
      "/portal/campaigns/summer-drop?joinError=Invite%20only",
    );
  });

  it("prefers the invitation when both are present", async () => {
    const fetchMock = mockFetch(200, { campaignPath: "/portal/campaigns/c2" });
    await landingAfterAuth({ invitation: "tok123", join: "summer-drop", invite: null, connect: null }, "/x");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/portal/invites/tok123/accept");
  });

  it("claims a connect link and lands on My accounts", async () => {
    const fetchMock = mockFetch(201, { alreadyLinked: false });
    await expect(landingAfterAuth({ ...none, connect: "tokABC" }, "/x")).resolves.toBe("/portal/accounts");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/portal/connect-link/claim");
    expect(JSON.parse(init.body)).toEqual({ token: "tokABC" });
  });

  it("goes to the fallback when the connect link is refused", async () => {
    mockFetch(409, { error: "linked elsewhere" });
    await expect(landingAfterAuth({ ...none, connect: "tokABC" }, "/x")).resolves.toBe("/x");
  });
});

describe("splitLinks", () => {
  it("pulls links out of pasted text in order, once each", () => {
    const text = `first https://www.tiktok.com/@fake_creator/video/1
      then https://www.instagram.com/reel/ABC/, and again https://www.tiktok.com/@fake_creator/video/1`;
    expect(splitLinks(text)).toEqual([
      "https://www.tiktok.com/@fake_creator/video/1",
      "https://www.instagram.com/reel/ABC/",
    ]);
  });

  it("trims punctuation a sentence leaves on the end", () => {
    expect(splitLinks("see (https://youtu.be/xyz).")).toEqual(["https://youtu.be/xyz"]);
  });

  it("ignores text with no links", () => {
    expect(splitLinks("no links here, www.example.com")).toEqual([]);
  });
});
