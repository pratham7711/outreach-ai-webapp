import fs from "fs";
import path from "path";
import { NAV_SECTIONS } from "@/components/NewSidebar";
import { DASHBOARD_NAV_RULES } from "@/lib/dashboardPolicy";

/**
 * The sidebar renders NAV_SECTIONS filtered by the allowlist that
 * DASHBOARD_NAV_RULES produces. An item with no rule is therefore invisible to
 * every organisation, not merely under-entitled ones -- a silent failure with
 * no error anywhere, which is why it has slipped through three times.
 */
describe("every sidebar item has a nav rule", () => {
  const ruleHrefs = new Set(DASHBOARD_NAV_RULES.map((r) => r.href));
  const navHrefs = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));

  it.each(navHrefs)("%s is covered by DASHBOARD_NAV_RULES", (href) => {
    expect(ruleHrefs.has(href)).toBe(true);
  });

  /**
   * Routes that have a rule but deliberately no sidebar item — "parked, not
   * deleted" per NewSidebar.tsx, plus the Settings hub cards, which are reached
   * from app/(dashboard)/settings/page.tsx rather than the rail. Pinning the
   * list here means keeping a route out of the sidebar is a decision someone
   * writes down, rather than something that happens by omission and is
   * indistinguishable from the bug above.
   */
  const PARKED = [
    "/inbox",
    "/fan-pages",
    "/payouts",
    "/requests",
    "/recipients",
    "/financial-reports",
    "/reports",
    "/media-kits",
    "/settings/profile",
    "/settings/notifications",
    "/settings/integrations",
  ];

  it("only these routes have a rule with no sidebar item, and they are parked on purpose", () => {
    const orphans = [...ruleHrefs].filter((h) => !navHrefs.includes(h));
    expect(orphans.sort()).toEqual([...PARKED].sort());
  });
});

/**
 * The other direction, and the one the three past regressions actually needed.
 *
 * The test above can only see routes someone already added to NAV_SECTIONS, so
 * a route that exists on disk and appears in neither place is invisible to it —
 * which is exactly how /financial-reports, /settings/profile,
 * /settings/notifications and /settings/integrations came to have no rule at
 * all. This walks app/(dashboard) instead, so a new page.tsx has to be
 * classified one way or the other before the suite goes green.
 */
describe("every dashboard route is accounted for", () => {
  const DASHBOARD_DIR = path.resolve(__dirname, "..", "..", "..", "app", "(dashboard)");

  function routes(dir: string, prefix = ""): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      // Dynamic segments are details of a parent route, not routes to link to.
      if (entry.name.startsWith("[")) continue;
      const href = `${prefix}/${entry.name}`;
      if (fs.existsSync(path.join(dir, entry.name, "page.tsx"))) out.push(href);
      out.push(...routes(path.join(dir, entry.name), href));
    }
    return out;
  }

  const ruleHrefs = new Set(DASHBOARD_NAV_RULES.map((r) => r.href));

  /**
   * Routes that exist and deliberately have no nav rule. Both are reached from
   * somewhere other than the allowlist, and each needs a reason in writing.
   */
  const NO_RULE_BY_DESIGN: Record<string, string> = {
    // Answers to the PLATFORM_ADMIN_EMAILS allowlist, not to what an org bought
    // — see PLATFORM_SECTION in NewSidebar.tsx, which skips the nav rules.
    "/platform": "operator-only, exempt from per-org entitlements",
    // A second way to create a campaign, linked from the /campaigns header.
    "/campaigns/self-serve": "deep link from /campaigns, not a nav destination",
    // The create form for /plans, which has a rule of its own.
    "/plans/new": "child form of /plans",
  };

  const found = routes(DASHBOARD_DIR);

  it("finds the routes at all — an empty walk would pass vacuously", () => {
    expect(found).toEqual(expect.arrayContaining(["/campaigns", "/settings/team", "/discovery"]));
    expect(found.length).toBeGreaterThan(20);
  });

  it.each(found)("%s has a nav rule or a written reason not to", (href) => {
    const classified = ruleHrefs.has(href) || href in NO_RULE_BY_DESIGN;
    expect(classified).toBe(true);
  });

  it("has no rule pointing at a route that does not exist", () => {
    const onDisk = new Set(found);
    expect([...ruleHrefs].filter((h) => !onDisk.has(h))).toEqual([]);
  });
});
