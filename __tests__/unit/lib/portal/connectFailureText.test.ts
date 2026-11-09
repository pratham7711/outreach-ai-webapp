/**
 * @jest-environment node
 *
 * The Connect failure banner says what to do, never the callback's step code.
 */
import { connectFailureText } from "@/lib/portal/connectFailureText";
import type { CallbackFailure } from "@/app/api/portal/connections/[platform]/callback/route";

const HANDLED: CallbackFailure[] = [
  "state",
  "token_exchange",
  "token_missing",
  "identity",
  "no_page",
  "no_instagram",
  "exception",
  "link",
];

describe("connectFailureText", () => {
  it.each(HANDLED)("words %s without the step code", (reason) => {
    const text = connectFailureText("TikTok", reason, "the agency");
    /* The old banner's shape: the code, underscores spaced out, in brackets. */
    expect(text).not.toContain(`(${reason.replace(/_/g, " ")})`);
    if (reason.includes("_")) expect(text).not.toContain(reason);
    expect(text.length).toBeGreaterThan(20);
  });

  it("names the platform where the platform is the subject", () => {
    expect(connectFailureText("TikTok", "token_exchange", "the agency")).toContain("TikTok");
    expect(connectFailureText("TikTok", "identity", "the agency")).toContain("TikTok");
  });

  it("falls back to a plain sentence for an unknown or missing step", () => {
    for (const reason of [null, "something_new"]) {
      const text = connectFailureText("TikTok", reason, "us");
      expect(text).toBe("Couldn't connect TikTok. Press Connect again, and tell us if it keeps happening.");
    }
  });

  it("names the choice in Facebook's dialog when no Page was shared, not just Connect again", () => {
    expect(connectFailureText("Instagram (via Facebook Page)", "no_page", "the agency")).toBe(
      "Facebook didn't share any Page with us. Press Connect again, choose “Opt in to current Pages only” and tick the Page your Instagram account is linked to.",
    );
    expect(connectFailureText("Facebook Page", "no_page", "the agency")).toContain("tick your Page.");
  });

  it("tells the creator who to contact", () => {
    expect(connectFailureText("YouTube", "exception", "the agency")).toContain("tell the agency");
  });
});

describe("connectFailureText under Instagram Unified login", () => {
  const KEY = "NEXT_PUBLIC_META_INSTAGRAM_LOGIN_CONFIG_ID";
  afterEach(() => {
    delete process.env[KEY];
  });

  it("does not send a Unified-login creator after a Facebook Page", () => {
    process.env[KEY] = "1789959975543946";
    const text = connectFailureText("Instagram", "no_instagram", "the agency");
    expect(text).not.toMatch(/Page/);
    expect(text).toMatch(/Creator or Business account/);
  });

  it("keeps the Page wording on the Facebook Login path", () => {
    expect(connectFailureText("Instagram", "no_instagram", "the agency")).toMatch(/Facebook Page/);
  });
});
