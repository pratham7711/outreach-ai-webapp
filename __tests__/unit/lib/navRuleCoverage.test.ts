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
   * deleted" per NewSidebar.tsx. They are reachable by URL and by deep links
   * from elsewhere in the app. Pinning the list here means parking a route is a
   * decision someone writes down, rather than something that happens by
   * omission and is indistinguishable from the bug above.
   */
  const PARKED = [
    "/inbox",
    "/fan-pages",
    "/payouts",
    "/requests",
    "/recipients",
    "/reports",
    "/media-kits",
  ];

  it("only these routes have a rule with no sidebar item, and they are parked on purpose", () => {
    const orphans = [...ruleHrefs].filter((h) => !navHrefs.includes(h));
    expect(orphans.sort()).toEqual([...PARKED].sort());
  });
});
