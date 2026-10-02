import { safeReturnTo, returnToWithQuery } from "@/lib/oauth/returnTo";

describe("safeReturnTo", () => {
  it("accepts portal paths", () => {
    expect(safeReturnTo("/portal/campaigns/summer?joined=1")).toBe(
      "/portal/campaigns/summer?joined=1",
    );
  });

  const rejected: Array<[string, string | null | undefined]> = [
    ["protocol-relative", "//evil.com"],
    ["absolute url", "https://evil.com"],
    ["outside the portal", "/dashboard"],
    ["not rooted", "portal/campaigns"],
    ["backslash", "/portal/x\\@evil.com"],
    ["header injection", "/portal/x\nLocation: https://evil.com"],
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
  ];

  it.each(rejected)("rejects %s", (_label, input) => {
    expect(safeReturnTo(input)).toBeNull();
  });
});

describe("returnToWithQuery", () => {
  it("falls back to settings when the path is not allowed", () => {
    expect(returnToWithQuery("https://evil.com", "connected=tiktok")).toBe(
      "/portal/settings?connected=tiktok",
    );
  });

  it("appends with ? when the path has no query", () => {
    expect(returnToWithQuery("/portal/dashboard", "connected=tiktok")).toBe(
      "/portal/dashboard?connected=tiktok",
    );
  });

  it("appends with & when the path already has a query", () => {
    expect(returnToWithQuery("/portal/campaigns/x?joined=1", "connected=tiktok")).toBe(
      "/portal/campaigns/x?joined=1&connected=tiktok",
    );
  });
});

describe("safeReturnTo — connect-link pages", () => {
  const token = "A".repeat(40) + "b-_";

  it("accepts exactly /connect/<token>, the page a signed-out creator starts from", () => {
    expect(safeReturnTo(`/connect/${token}`)).toBe(`/connect/${token}`);
    expect(returnToWithQuery(`/connect/${token}`, "connected=tiktok")).toBe(
      `/connect/${token}?connected=tiktok`,
    );
  });

  it.each([
    ["a short token", "/connect/abc"],
    ["a further path", `/connect/${token}/../../dashboard`],
    ["a query smuggled in", `/connect/${token}?next=//evil.com`],
    ["a protocol-relative lookalike", "//connect/" + token],
    ["a header injection", `/connect/${token}\nLocation: https://evil.com`],
  ])("rejects %s", (_label, input) => {
    expect(safeReturnTo(input)).toBeNull();
  });
});
