import {
  ACCOUNT_ORIGINS,
  originForPlatform,
  isInstagramLoginRow,
  isAuthorizedOrigin,
} from "@/lib/platforms/accountOrigin";

describe("originForPlatform", () => {
  it("separates the two Instagram paths", () => {
    /* Both write platform = INSTAGRAM, so this string is the only thing that
       can tell them apart at disconnect time. */
    expect(originForPlatform("instagram")).toBe(ACCOUNT_ORIGINS.OAUTH);
    expect(originForPlatform("instagram-login")).toBe(
      ACCOUNT_ORIGINS.OAUTH_INSTAGRAM_LOGIN,
    );
    expect(originForPlatform("instagram")).not.toBe(
      originForPlatform("instagram-login"),
    );
  });

  it("records plain oauth for every other platform", () => {
    for (const p of ["tiktok", "youtube", "facebook", "threads"] as const) {
      expect(originForPlatform(p)).toBe(ACCOUNT_ORIGINS.OAUTH);
    }
  });
});

describe("isInstagramLoginRow", () => {
  it("is true only for the Instagram Login origin", () => {
    expect(isInstagramLoginRow(ACCOUNT_ORIGINS.OAUTH_INSTAGRAM_LOGIN)).toBe(true);
    expect(isInstagramLoginRow(ACCOUNT_ORIGINS.OAUTH)).toBe(false);
    expect(isInstagramLoginRow(ACCOUNT_ORIGINS.MANUAL)).toBe(false);
    expect(isInstagramLoginRow(ACCOUNT_ORIGINS.DEV)).toBe(false);
  });

  it("reads a legacy null row as NOT Instagram Login", () => {
    /* Every row written before the column existed predates the flow, so it
       cannot have come from it — and it must keep going to the Facebook revoke,
       which is where it did come from. Getting this backwards would silently
       stop revoking for every existing Instagram connection. */
    expect(isInstagramLoginRow(null)).toBe(false);
    expect(isInstagramLoginRow(undefined)).toBe(false);
  });

  it("does not treat an unknown origin as Instagram Login", () => {
    expect(isInstagramLoginRow("oauth_instagram")).toBe(false);
    expect(isInstagramLoginRow("instagram_login")).toBe(false);
    expect(isInstagramLoginRow("")).toBe(false);
  });
});

describe("isAuthorizedOrigin", () => {
  it("counts both OAuth paths as holding a real credential", () => {
    expect(isAuthorizedOrigin(ACCOUNT_ORIGINS.OAUTH)).toBe(true);
    expect(isAuthorizedOrigin(ACCOUNT_ORIGINS.OAUTH_INSTAGRAM_LOGIN)).toBe(true);
  });

  it("never counts a hand-entered row", () => {
    /* app/api/creators/[id]/social-accounts defaults accessToken to the literal
       string "manual-entry". A Verified badge over that row would assert an
       authorised read of a token that does not exist. */
    expect(isAuthorizedOrigin(ACCOUNT_ORIGINS.MANUAL)).toBe(false);
  });

  it("never counts a dev row or an unknown one", () => {
    expect(isAuthorizedOrigin(ACCOUNT_ORIGINS.DEV)).toBe(false);
    /* A legacy row may be either, so it must not be reported as authorized:
       between overstating and understating provenance, understate. */
    expect(isAuthorizedOrigin(null)).toBe(false);
    expect(isAuthorizedOrigin("something-else")).toBe(false);
  });
});
