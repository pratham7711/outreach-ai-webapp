/**
 * @jest-environment node
 */
import fs from "fs";
import path from "path";
import { PAYOUTS_ENABLED } from "@/lib/payouts/switch";

/*
 * The creator app parks six screens and renames two (next.config.ts,
 * PARKED_PAGE_REDIRECTS). next.config.ts reads import.meta, which jest's CJS
 * transform cannot load, so the list is read as text -- the same list the
 * e2e navigation spec requests over HTTP.
 */
const ROOT = path.resolve(__dirname, "../../..");
const config = fs.readFileSync(path.join(ROOT, "next.config.ts"), "utf8");

function pairsIn(name: string): Array<[string, string]> {
  const start = config.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`${name} is not in next.config.ts`);
  const end = config.indexOf("];", start);
  const block = config.slice(start, end);
  return [...block.matchAll(/\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/g)].map((m) => [m[1], m[2]]);
}

/* Earnings and payout requests moved to PAYOUT_PAGE_REDIRECTS, which applies
   only while payouts are switched off (lib/payouts/switch.ts). */
function parkedPairs(): Array<[string, string]> {
  return [
    ...pairsIn("PARKED_PAGE_REDIRECTS"),
    ...(PAYOUTS_ENABLED ? [] : pairsIn("PAYOUT_PAGE_REDIRECTS")),
  ];
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
    ["/portal/reviews", "/portal/dashboard"],
    ["/portal/discover", "/portal/campaigns?tab=open"],
    ["/portal/settings", "/portal/accounts"],
    ...(PAYOUTS_ENABLED
      ? []
      : [
          ["/portal/earnings", "/portal/dashboard"],
          ["/portal/payout-requests", "/portal/dashboard"],
        ]),
  ])("%s redirects to %s", (from, to) => {
    expect(portal).toContainEqual([from, to]);
  });

  it("keeps the payout screens' redirects behind the payouts switch", () => {
    expect(pairsIn("PAYOUT_PAGE_REDIRECTS")).toEqual(
      expect.arrayContaining([
        ["/portal/earnings", "/portal/dashboard"],
        ["/portal/payout-requests", "/portal/dashboard"],
      ]),
    );
    expect(pairsIn("PARKED_PAGE_REDIRECTS").map(([from]) => from)).not.toEqual(
      expect.arrayContaining(["/portal/earnings"]),
    );
    expect(config).toMatch(/PAYOUTS_ENABLED \? \[\] : PAYOUT_PAGE_REDIRECTS/);
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

  const layout = fs.readFileSync(path.join(ROOT, "app/(portal)/portal/layout.tsx"), "utf8");
  const hrefsIn = (name: string) => {
    const start = layout.indexOf(`const ${name} = [`);
    if (start < 0) throw new Error(`${name} is not in the portal layout`);
    const block = layout.slice(start, layout.indexOf("];", start));
    return [...block.matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
  };

  it("the creator nav links only to kept screens", () => {
    expect(hrefsIn("NAV_LINKS")).toEqual([
      "/portal/dashboard",
      "/portal/campaigns",
      "/portal/accounts",
      "/portal/stats",
      "/portal/account",
    ]);
  });

  it("adds the payout screen to the nav only when payouts are switched on", () => {
    expect(hrefsIn("PAYOUT_NAV_LINKS")).toEqual(["/portal/earnings"]);
    expect(layout).toMatch(/\.\.\.\(PAYOUTS_ENABLED \? PAYOUT_NAV_LINKS : \[\]\)/);
    /* Whatever the nav links to is never also redirected away. */
    const parkedFrom = portal.map(([from]) => from);
    if (PAYOUTS_ENABLED) expect(parkedFrom).not.toContain("/portal/earnings");
    else expect(parkedFrom).toContain("/portal/earnings");
  });
});
