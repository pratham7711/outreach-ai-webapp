/**
 * Every reference surface worth measuring, and the four viewports.
 *
 * Navigation is always by URL. The existing scripts learned this the hard way:
 * clicking sidebar text mis-targeted neighbouring entries, while the tab=
 * tokens below were confirmed from the URLs the app itself produced.
 *
 * Two traps encoded here rather than left as comments:
 *   - Settings is its OWN page at /settings?tab=<Name>. /dashboard?tab=Settings
 *     silently falls back to Campaigns, which screenshots perfectly and is
 *     completely wrong.
 *   - Campaign ids are NOT stable. The id hardcoded in cc-ui-inventory.mjs no
 *     longer exists in this org, so every campaign surface it captured would be
 *     an error page. Ids come from fixtures.json, refreshed by discover.mjs.
 */

/**
 * Fresh-loaded, never resized. app/globals.css:1656-1666 records why: this
 * Bubble app's responsive groups keep resize history, so resizing a live page
 * gives different numbers than loading it at that size.
 */
export const VIEWPORTS = [
  { id: "desktop-1600", width: 1600, height: 1000, kind: "desktop" },
  { id: "desktop-1440", width: 1440, height: 900, kind: "desktop" },
  { id: "tablet-768", width: 768, height: 1024, kind: "tablet" },
  { id: "mobile-390", width: 390, height: 844, kind: "mobile" },
];

/** Left-nav destinations. Tokens confirmed from the app's own URLs. */
export const NAV_SURFACES = [
  ["campaigns", "/dashboard?tab=Campaigns"],
  ["activations", "/dashboard?tab=Activations"],
  ["calendar", "/dashboard?tab=Calendar"],
  ["clients", "/dashboard?tab=Clients"],
  ["fan-pages", "/dashboard?tab=FanPages"],
  ["trackers-sound", "/dashboard?tab=Trackers&sub=sound&period=7"],
  ["trackers-creator", "/dashboard?tab=Trackers&sub=creator&period=7"],
  ["discovery", "/dashboard?tab=Discovery&platform=TikTok"],
  ["creators", "/dashboard?tab=Creators"],
  ["lists", "/dashboard?tab=Lists"],
  ["payouts", "/dashboard?tab=Payouts"],
  ["requests", "/dashboard?tab=Requests"],
  ["recipients", "/dashboard?tab=Recipients"],
  ["connections", "/dashboard?tab=Connections"],
];

export const SETTINGS_TABS = [
  "General", "Account", "Notifications", "Branding", "Team", "Stories", "Integrations",
];

export const CAMPAIGN_SUBTABS = [
  "Overview", "Creators", "Drafts", "Posts", "Analytics", "Financials", "Documents", "Settings",
];

/**
 * Builds the run list. Campaign sub-tabs are captured against all three
 * fixtures because data volume changes layout -- a 50-post campaign and an
 * empty one are different screens, and the empty one is kept precisely AS the
 * empty case rather than skipped for being "too quiet to spec from".
 */
/**
 * Which shell a URL lands in. MUST be derived from the URL, never sniffed from
 * the DOM: below the 1024px rail breakpoint the nav moves into a drawer and is
 * hidden, so a body-text probe for "Campaigns & Reporting" reports every
 * dashboard surface as a campaign one. Measured at 768px, where it mislabelled
 * the entire viewport's run.
 */
export function shellFor(path) {
  if (path.startsWith("/settings")) return "settings";
  if (/[?&]tab=Campaign(&|$)/.test(path)) return "campaign";
  return "dashboard";
}

export function buildSurfaces(fixtures) {
  const surfaces = [];
  for (const [id, path] of NAV_SURFACES) surfaces.push({ id, path, group: "nav", shell: shellFor(path) });
  for (const tab of SETTINGS_TABS) {
    const path = `/settings?tab=${tab}`;
    surfaces.push({ id: `settings-${tab.toLowerCase()}`, path, group: "settings", shell: shellFor(path) });
  }
  for (const [role, fx] of Object.entries(fixtures)) {
    if (!fx?.id) continue;
    for (const sub of CAMPAIGN_SUBTABS) {
      const path = `/dashboard?tab=Campaign&campaign=${fx.id}&sub=${sub}`;
      surfaces.push({
        id: `campaign-${role}-${sub.toLowerCase()}`,
        path,
        shell: shellFor(path),
        group: "campaign",
        fixture: role,
        fixtureName: fx.name,
      });
    }
  }
  return surfaces;
}
