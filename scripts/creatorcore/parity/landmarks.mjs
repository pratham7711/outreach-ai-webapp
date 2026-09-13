/**
 * The join key between two unrelated DOMs.
 *
 * CreatorCore is Bubble-generated: no <nav>, no roles, no stable classes. Ours
 * is hand-written React. So neither side's selectors appear in the diff --
 * instead each landmark has an id, and each side resolves that id its own way.
 * Ours will resolve through a `data-parity="<id>"` attribute (NOT data-testid:
 * a test selector moving must not silently break a measurement).
 *
 * `origin` is the load-bearing field. Every measurement is expressed relative
 * to its origin landmark, never the viewport, because our nav has 20 entries to
 * their 14 -- so every absolute y below the fold differs by a number that means
 * nothing about layout.
 */

/** Resolver strategies, each lifted from a script that already works here. */
export const STRATEGY = {
  /** cc-sidebar-spec.mjs:75-91 -- anchor on guaranteed text, walk out to a shape. */
  ANCHOR_WALK: "anchorWalk",
  /** cc-badge-colors.mjs:55-63 -- walk <=4 hops to whatever actually paints. */
  PAINTED_ANCESTOR: "paintedAncestor",
  /** Position/size predicate, for things with no text of their own. */
  GEOMETRY: "geometry",
  /** A repeated run of siblings: nav rows, list rows, stat tiles. */
  SERIES: "series",
  /** Ours only: an explicit data-parity attribute on markup we control. */
  SELECTOR: "selector",
  /** The nearest ancestor of an already-resolved landmark that spans the column. */
  ANCESTOR_OF: "ancestorOf",
};

export const LANDMARKS = [
  {
    id: "shell.rail",
    shells: ["dashboard"],
    // The rail is removed from the DOM below this width, not hidden.
    minViewportWidth: 1024,
    origin: null,
    desc: "The left navigation rail",
    ref: {
      strategy: STRATEGY.ANCHOR_WALK,
      anchorText: "Campaigns & Reporting",
      // A floating inset card, not a panel flush to x=0, so it cannot be found
      // by position -- this is exactly why anchorWalk exists.
      ancestor: { bgIsWhite: true, minWidth: 180, maxWidth: 320 },
    },
    ours: { strategy: STRATEGY.SELECTOR, css: '[data-parity="shell.rail"]' },
  },
  {
    id: "shell.rail.group-first",
    shells: ["dashboard"],
    // The rail is removed from the DOM below this width, not hidden.
    minViewportWidth: 1024,
    origin: "shell.rail",
    desc: "First nav group label",
    ref: { strategy: STRATEGY.ANCHOR_WALK, anchorText: "Campaigns & Reporting", ancestor: null },
    // The LABEL, not the group box. Their side resolves this by anchoring on the
    // group's text, so it is 174.5x18.8; tagging our wrapping <div> instead made
    // it 220x450.8 and produced a 432px "difference" that was purely mine.
    ours: { strategy: STRATEGY.SELECTOR, css: '[data-parity="shell.rail.group-first"] .cc-nav-group-label' },
  },
  {
    id: "shell.rail.items",
    shells: ["dashboard"],
    // The rail is removed from the DOM below this width, not hidden.
    minViewportWidth: 1024,
    origin: "shell.rail",
    desc: "The nav rows as a series -- yields pitch, gapEffective, labelInset",
    ref: {
      strategy: STRATEGY.SERIES,
      within: "shell.rail",
      // Every nav label. The resolver keeps only the longest run sharing one
      // parent, so the pitch it reports is row-to-row inside a group and never
      // the larger gap between groups.
      itemText: [
        "Campaigns", "Activations", "Calendar", "Clients", "Fan Pages", "Trackers",
        "Discovery", "Creators", "Stories", "Lists",
        "Payouts", "Requests", "Recipients", "Connections", "Settings",
      ],
    },
    ours: { strategy: STRATEGY.SELECTOR, series: true, css: '[data-parity="shell.rail.items"] .cc-nav-item' },
  },
  {
    id: "page.title",
    shells: ["dashboard", "campaign", "settings"],
    origin: null,
    desc: "The h1-equivalent for the current screen",
    ref: {
      strategy: STRATEGY.GEOMETRY,
      // rightOfRail is false: /settings is a different shell with no rail, and
      // requiring one excluded its title entirely.
      biggestTextInBand: {
        maxTop: 90, rightOfRail: false, minWidth: 40, minFontSize: 16,
        // Content side only -- see the note in probe.mjs.
        maxLeftRatio: 0.5,
      },
    },
    ours: { strategy: STRATEGY.SELECTOR, css: '[data-parity="page.title"]' },
  },
  {
    id: "page.header-strip",
    shells: ["dashboard", "campaign", "settings"],
    origin: null,
    desc:
      "The strip holding the page title and its actions. MEASURED FINDING: " +
      "CreatorCore has no painted top bar at all -- this strip is transparent " +
      "(1263x40 at y=26, background rgba(0,0,0,0)) and simply contains the " +
      "title and the primary action. Ours is a painted 56px bar with a border. " +
      "That is a genuine structural difference, not a failed match, and the " +
      "diff must report it as such rather than chase a 16px height drift.",
    // Width is a FRACTION of the viewport: an absolute 900px can never match
    // inside a 768px or 390px viewport, so the strip reported unresolved at
    // both narrow sizes purely as an artefact of the threshold.
    ref: {
      strategy: STRATEGY.ANCESTOR_OF,
      of: "page.title",
      minWidthRatio: 0.55,
      maxHeight: 120,
      hops: 6,
    },
    ours: { strategy: STRATEGY.SELECTOR, css: '[data-parity="page.header-strip"]' },
  },
  {
    id: "page.primary-action",
    shells: ["dashboard", "campaign"],
    origin: "page.title",
    desc: "The main create/new button on the screen",
    ref: {
      strategy: STRATEGY.PAINTED_ANCESTOR,
      anchorPattern: "^(New |Add |Create|Export|Invite|Connect)\\b",
      maxTop: 90,
      hops: 4,
    },
    /* Was `> *:first-child`, and that resolved the wrong element on 6 of the 13
       screens where it resolved at all -- a "56 events" count on /audit-log, the
       7D/30D/90D range picker on /dashboard, a "Folders" chip on /campaigns. The
       primary action now says so itself: components/ds/Button emits
       data-cc-slot="primary" for variant="primary". */
    ours: {
      strategy: STRATEGY.SELECTOR,
      css: '[data-region="page-actions"] [data-cc-slot="primary"]',
      pick: "last",
    },
  },
  {
    id: "list.rows",
    shells: ["dashboard", "campaign", "settings"],
    origin: null,
    desc: "The main content list/grid rows as a series",
    // Generic, because the campaign-only text markers this replaced resolved
    // nothing on /creators, /payouts or /settings -- which is why most surfaces
    // reported 5 of 7 landmarks on the first full run.
    ref: {
      strategy: STRATEGY.SERIES,
      siblingRun: { minCount: 3, minWidth: 200, rightOfRail: false },
    },
    /* Scoped to `main`, and that is not a tidy-up: `.cc-table-row` is also the
       class on the rail's own user button, so the unscoped selector resolved a
       216px-wide sidebar control as "the content list" and reported it against
       their 1177px content rows on 23 surfaces. A content landmark has to be
       addressed to the content. */
    ours: {
      strategy: STRATEGY.SELECTOR,
      series: true,
      css: 'main [data-region="list-row"], main .cc-table-row, main table tbody tr',
    },
  },
  {
    id: "campaign.rail",
    shells: ["campaign"],
    minViewportWidth: 1024,
    origin: null,
    desc:
      "On a campaign detail page the rail BECOMES the campaign: the global nav " +
      "is replaced by Overview/Creators/Drafts/Posts/Analytics/Financials/" +
      "Documents/Settings. Measured, and the reason campaign surfaces reported " +
      "shell.rail as unresolved -- it is genuinely not there. " +
      "MEASURED SHAPE: 208x1000 at (0,0), background rgb(31,60,239) -- a " +
      "full-bleed panel in the brand blue, where the dashboard rail is a " +
      "floating WHITE card inset by 10/15px. Rows are 166x50 at x=21 with a " +
      "50px pitch (dashboard rows are 220x40 at 48px).",
    ref: {
      strategy: STRATEGY.ANCHOR_WALK,
      anchorText: "Overview",
      ancestor: { bgPainted: true, minWidth: 180, maxWidth: 320 },
    },
    ours: { strategy: STRATEGY.SELECTOR, css: '[data-parity="shell.rail"]' },
  },
  {
    id: "campaign.rail.items",
    shells: ["campaign"],
    minViewportWidth: 1024,
    origin: "campaign.rail",
    desc: "The campaign sub-nav rows -- yields pitch, gapEffective, labelInset",
    ref: {
      strategy: STRATEGY.SERIES,
      within: "campaign.rail",
      itemText: [
        "Overview", "Creators", "Drafts", "Posts",
        "Analytics", "Financials", "Documents", "Settings",
      ],
    },
    ours: { strategy: STRATEGY.SELECTOR, series: true, css: '[data-parity="shell.rail.items"] .cc-nav-item' },
  },
  {
    id: "settings.nav",
    shells: ["settings"],
    origin: null,
    desc: "The settings shell's own left nav (My Settings / Account / ...)",
    ref: {
      strategy: STRATEGY.ANCHOR_WALK,
      anchorText: "My Settings",
      ancestor: { bgIsWhite: false, minWidth: 120, maxWidth: 320 },
    },
    ours: {
      strategy: STRATEGY.SELECTOR,
      // MEASURED: there is no settings tab navigation in our app. /settings is
      // an index page of links and each tab is its own route with no shared
      // nav -- app/(dashboard)/settings/ has no layout.tsx and no SettingsNav
      // component exists. CreatorCore resolves this landmark on every settings
      // screen. That is a real structural gap, recorded as one.
      knownAbsent: "no settings tab nav exists in our app; /settings is an index of links",
      css: '[data-region="settings-nav"]',
    },
  },
];

export const byId = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));
