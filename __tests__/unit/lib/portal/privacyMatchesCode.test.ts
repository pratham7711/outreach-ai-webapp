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
    ["Instagram Login", /Through Instagram Login/],
    ["Google's Limited Use wording", /Google API Services User Data Policy[\s\S]*Limited Use requirements/],
    ["public lookups of unconnected creators", /Creators who have not connected an account/],
  ])("covers %s", (_label, pattern) => {
    expect(privacy).toMatch(pattern);
  });

  it("claims no audience demographics", () => {
    expect(privacy).toMatch(/do not read audience demographics/);
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
