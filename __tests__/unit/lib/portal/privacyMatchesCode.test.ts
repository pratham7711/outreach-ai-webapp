/**
 * @jest-environment node
 */
import fs from "fs";
import path from "path";
import { OAUTH_PLATFORMS } from "@/lib/oauth/providers";
import { WHAT_WE_READ } from "@/lib/portal/whatWeRead";

/*
 * The privacy policy and the data deletion page are what platform reviewers
 * read beside the consent screens. Each permission the code requests
 * (WHAT_WE_READ is checked against the real authorize URLs in
 * whatWeRead.test.ts) must be named in the policy, so adding a scope without
 * disclosing it fails here rather than in a review.
 */
const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const privacy = read("app/(public)/privacy/page.tsx");
const deletion = read("app/(public)/data-deletion/page.tsx");

const shortScope = (scope: string) => scope.replace("https://www.googleapis.com/auth/", "");

describe("privacy policy matches what the code reads", () => {
  const scopes = [...new Set(OAUTH_PLATFORMS.flatMap((p) => WHAT_WE_READ[p].map((r) => shortScope(r.scope))))];

  it.each(scopes)("names the %s permission", (scope) => {
    expect(privacy).toContain(`<code>${scope}</code>`);
  });

  it.each([
    ["Facebook Pages", /Facebook Pages/],
    ["Threads", /<strong>Threads<\/strong>/],
    ["Instagram Login, as not offered", /Instagram Login<\/em>, which needs no Facebook Page, is not offered/],
    ["Google's Limited Use wording", /Google API Services User Data Policy[\s\S]*Limited Use requirements/],
    ["public lookups of unconnected creators", /Creators who have not connected an account/],
  ])("covers %s", (_label, pattern) => {
    expect(privacy).toMatch(pattern);
  });

  it("discloses Instagram follower demographics and claims none elsewhere", () => {
    expect(privacy).toMatch(/followers&rsquo; country, age and gender/);
    expect(privacy).toMatch(/Apart from the Instagram follower demographics above[\s\S]*we do not read audience\s+demographics from any platform/);
  });

  it("discloses account and story insights under instagram_manage_insights", () => {
    expect(privacy).toMatch(/insights\s+on stories while they are live/);
  });
});

/*
 * TikTok returns only the fields a request names, so the field lists in
 * lib/platforms/tiktokDisplay.ts are exactly what is read. Every one of them
 * must be described in the policy's TikTok entry and on My accounts; a field
 * added to a request without a phrase here fails until it is disclosed.
 */
describe("TikTok fields the code requests are disclosed", () => {
  const display = read("lib/platforms/tiktokDisplay.ts");
  const fieldsOf = (name: string) => {
    const list = display.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`));
    if (!list) throw new Error(`${name} not found in tiktokDisplay.ts`);
    return [...list[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  };
  const counts = "view, like, comment and share counts";
  const PHRASE: Record<string, string> = {
    open_id: "account ID",
    username: "username",
    display_name: "display name",
    avatar_url: "profile picture",
    bio_description: "bio",
    profile_deep_link: "profile link",
    is_verified: "verified",
    follower_count: "follower",
    following_count: "following",
    likes_count: "total likes",
    video_count: "video counts",
    id: "ID",
    title: "title",
    video_description: "description",
    duration: "length",
    cover_image_url: "cover image",
    share_url: "share link",
    embed_link: "embed link",
    create_time: "date posted",
    view_count: counts,
    like_count: counts,
    comment_count: counts,
    share_count: counts,
  };
  const fields = [...new Set([...fieldsOf("USER_FIELDS"), ...fieldsOf("VIDEO_FIELDS")])];
  const start = privacy.indexOf('platform="TIKTOK"');
  const policyEntry = privacy.slice(start, privacy.indexOf("</LegalPlatform>", start)).replace(/\s+/g, " ");
  const inApp = WHAT_WE_READ.tiktok.map((r) => r.reads).join(" ");

  it("finds the field lists", () => {
    expect(fields.length).toBeGreaterThan(10);
  });

  it.each(fields)("describes %s in the policy and on My accounts", (field) => {
    const phrase = PHRASE[field];
    expect(phrase).toBeDefined();
    expect(policyEntry).toContain(phrase);
    expect(inApp).toContain(phrase);
  });
});

describe("data deletion page", () => {
  it.each([
    ["Disconnect", /Disconnect one account/],
    ["Delete my account", /Delete my account and data/],
    ["the Meta deletion callback", /Remove the app from Facebook, Instagram or Threads/],
    ["the privacy contact", /LEGAL\.privacyEmail/],
  ])("explains %s", (_label, pattern) => {
    expect(deletion).toMatch(pattern);
  });

  it("is linked from the privacy policy", () => {
    expect(privacy).toContain('href="/data-deletion"');
  });
});
