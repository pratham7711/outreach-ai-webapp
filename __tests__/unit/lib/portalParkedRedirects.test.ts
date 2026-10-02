/**
 * @jest-environment node
 */
import fs from "fs";
import path from "path";

/*
 * The creator app parks six screens and renames two (next.config.ts,
 * PARKED_PAGE_REDIRECTS). next.config.ts reads import.meta, which jest's CJS
 * transform cannot load, so the list is read as text -- the same list the
 * e2e navigation spec requests over HTTP.
 */
const ROOT = path.resolve(__dirname, "../../..");
const config = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");

function parkedPairs(): Array<[string, string]> {
  const start = config.indexOf("const PARKED_PAGE_REDIRECTS");
  const end = config.indexOf("];", start);
  const block = config.slice(start, end);
  return [...block.matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)].map((m) => [m[1], m[2]]);
}

const pageFile = (url: string) =>
  path.join(ROOT, "app/(portal)", url.split("?")[0], "page.tsx");

describe("creator app parked screens", () => {
  const pairs = parkedPairs();
  const portal = pairs.filter(([from]) => from.startsWith("/portal/"));

  it.each([
    ["/portal/messages", "/portal/dashboard"],
    ["/portal/offers", "/portal/dashboard"],
    ["/portal/proposals", "/portal/dashboard"],
    ["/portal/earnings", "/portal/dashboard"],
    ["/portal/reviews", "/portal/dashboard"],
    ["/portal/payout-requests", "/portal/dashboard"],
    ["/portal/discover", "/portal/campaigns?tab=open"],
    ["/portal/settings", "/portal/accounts"],
  ])("%s redirects to %s", (from, to) => {
    expect(portal).toContainEqual([from, to]);
  });

  it("redirects temporarily (307), so bringing a screen back is a deploy", () => {
    expect(config).toMatch(/permanent:\s*false/);
    expect(config).not.toMatch(/permanent:\s*true/);
  });

  it("keeps the parked screens' code on disk", () => {
    for (const [from] of portal) expect(fs.existsSync(pageFile(from))).toBe(true);
  });

  it("sends every parked screen to a page that exists", () => {
    for (const [, to] of portal) expect(fs.existsSync(pageFile(to))).toBe(true);
  });

  it.each([
    "/portal/dashboard",
    "/portal/campaigns",
    "/portal/accounts",
    "/portal/stats",
    "/portal/account",
    "/portal/login",
    "/portal/register",
  ])("never redirects the kept screen %s", (kept) => {
    expect(portal.map(([from]) => from)).not.toContain(kept);
  });

  it("the creator nav links only to kept screens", () => {
    const layout = fs.readFileSync(path.join(ROOT, "app/(portal)/portal/layout.tsx"), "utf8");
    const hrefs = [...layout.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      "/portal/dashboard",
      "/portal/campaigns",
      "/portal/accounts",
      "/portal/stats",
      "/portal/account",
    ]);
  });
});
