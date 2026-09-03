/**
 * TikTok fails review for an app that requests a scope its portal entry does
 * not declare. TIKTOK_SCOPES can override what we request and is a sensitive
 * production variable that cannot be read back, so the guarantee has to hold
 * in code: the override narrows, never widens.
 */
import { buildAuthorizeUrl } from "@/lib/oauth/providers";

const DECLARED = ["user.info.basic", "user.info.profile", "user.info.stats", "video.list"];

function scopesOf(url: string | null): string[] {
  if (!url) throw new Error("no authorize url");
  const raw = new URL(url).searchParams.get("scope") ?? "";
  return raw.split(",").filter(Boolean);
}

describe("TikTok authorize scopes", () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, TIKTOK_CLIENT_KEY: "k", TIKTOK_CLIENT_SECRET: "s" };
  });
  afterEach(() => {
    process.env = env;
  });

  it("requests exactly the declared four when no override is set", () => {
    delete process.env.TIKTOK_SCOPES;
    expect(scopesOf(buildAuthorizeUrl("tiktok", "st")).sort()).toEqual([...DECLARED].sort());
  });

  it("lets the override narrow to a subset", () => {
    process.env.TIKTOK_SCOPES = "user.info.basic,video.list";
    expect(scopesOf(buildAuthorizeUrl("tiktok", "st")).sort()).toEqual(
      ["user.info.basic", "video.list"].sort()
    );
  });

  it("drops an undeclared scope instead of asking TikTok for it", () => {
    process.env.TIKTOK_SCOPES = "user.info.basic,video.upload,video.publish";
    expect(scopesOf(buildAuthorizeUrl("tiktok", "st"))).toEqual(["user.info.basic"]);
  });

  it("falls back to the declared set when the override names nothing declared", () => {
    process.env.TIKTOK_SCOPES = "video.upload";
    expect(scopesOf(buildAuthorizeUrl("tiktok", "st")).sort()).toEqual([...DECLARED].sort());
  });

  it("tolerates whitespace and stray separators", () => {
    process.env.TIKTOK_SCOPES = "  user.info.basic ,, user.info.stats  ";
    expect(scopesOf(buildAuthorizeUrl("tiktok", "st")).sort()).toEqual(
      ["user.info.basic", "user.info.stats"].sort()
    );
  });

  it("never requests a scope outside the declared set, whatever the override says", () => {
    process.env.TIKTOK_SCOPES = "user.info.basic,video.upload,research.data,user.info.stats";
    for (const s of scopesOf(buildAuthorizeUrl("tiktok", "st"))) {
      expect(DECLARED).toContain(s);
    }
  });
});
