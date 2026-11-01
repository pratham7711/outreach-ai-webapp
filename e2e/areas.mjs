/**
 * The one place that says which E2E specs cover which part of the app.
 *
 * Read by scripts/e2e-area.mjs (to run an area) and by the deploy gate (to work
 * out which areas a diff touches). Keeping both on the same table is the point:
 * if the runner and the gate disagreed about what "the campaigns area" means,
 * a targeted run could clear a gate it never actually exercised.
 *
 * `sources` are PREFIX matches against repo-relative paths, not globs -- the
 * route groups are literally named "app/(dashboard)/..." and quoting parens
 * through a glob, a shell and a hook is three chances to get it silently wrong.
 *
 * SAFETY: a changed path that matches no area's `sources` is treated as
 * cross-cutting and forces the whole suite. The map failing to mention
 * something therefore costs time, never coverage -- which is the only direction
 * an incomplete map is allowed to fail in.
 */

export const AREAS = {
  auth: {
    specs: ["auth.spec.ts", "signup-org-types.spec.ts", "portal-auth.spec.ts", "auth-pages.spec.ts"],
    sources: [
      "app/(auth)/",
      "app/api/auth/",
      "lib/auth",
      // Signing up, confirming the address, accepting a team invitation.
      "app/api/signup/",
      "app/api/invites/accept/",
      "lib/emailVerification.ts",
      "lib/loginRateLimit.ts",
    ],
  },
  campaigns: {
    specs: [
      "campaigns.spec.ts",
      "campaigns-detail.spec.ts",
      "calendar.spec.ts",
      "campaign-audio.spec.ts",
    ],
    sources: [
      "app/(dashboard)/campaigns/",
      "app/(dashboard)/activations/",
      "app/(dashboard)/deadlines/",
      "app/(dashboard)/calendar/",
      "app/api/campaigns/",
      "components/campaigns/",
      "components/posts/",
      // Track this campaign's creators, on the campaign's Creators tab.
      "components/creators/TrackCreators.tsx",
      "lib/sync/",
      /* Mapped 2026-10-13 from the import graph: every route that imports these
         is a campaigns route (or a cron that writes campaign posts, which no
         spec calls -- a full run would not exercise it either, so the campaigns
         specs are the sanity check for it). */
      "app/api/activations/",
      "app/api/calendar/",
      "app/api/deadlines/",
      "app/api/folders/",
      "app/api/fraud-flags/",
      "app/api/posts/",
      "app/api/cron/sync-posts/",
      "app/api/cron/sync-instagram-posts/",
      "app/api/admin/cc-sync/",
      "app/api/admin/repair-dead-letters/",
      "app/api/admin/unseal-live-posts/",
      "app/api/platform/unseal-misfired-ttl/",
      // The MCP server: no spec drives it; campaigns and their posts are what it reads.
      "app/api/mcp/",
      /* The Spotify link on a campaign's song: checked from the New Campaign
         form and the campaign's audio settings, and the one-off DDL for its
         column and the Instagram audio's.
         The check route also sits under app/api/songs/, so it runs the songs
         area too. */
      "app/api/songs/spotify-check/",
      "app/api/admin/migrate-song-links/",
    ],
  },
  analytics: {
    specs: ["gate2-dashboard.spec.ts", "dashboard.spec.ts"],
    sources: [
      "app/(dashboard)/analytics/",
      "app/(dashboard)/dashboard/",
      "app/(dashboard)/reports/",
      "app/(dashboard)/financial-reports/",
      "app/(public)/share/",
      "app/api/analytics/",
      "app/api/share/",
      "components/charts/",
      // Mapped 2026-10-13 from the import graph (see campaigns above).
      "app/api/dashboard/",
      "app/api/financial-reports/",
      "app/api/reports/",
      "app/api/cron/snapshot-org-views/",
    ],
  },
  creators: {
    specs: [
      "creators.spec.ts",
      "creators-detail.spec.ts",
      "creator-finder.spec.ts",
      "lists.spec.ts",
      "public-profile.spec.ts",
      "shared-links.spec.ts",
    ],
    sources: [
      "app/(dashboard)/creators/",
      "app/(dashboard)/lists/",
      "app/(dashboard)/discovery/",
      "app/(dashboard)/fan-pages/",
      "app/(dashboard)/media-kits/",
      // Creator Finder (LKM only): the board, its routes and its tables.
      "app/(dashboard)/creator-finder/",
      "app/api/creator-finder/",
      "app/api/admin/migrate-creator-finder/",
      "lib/creatorFinder/",
      "app/api/creators/",
      "app/api/discovery/",
      "lib/platforms/",
      // The roster, its lists and a list's public link. Shared pieces that other
      // screens render too (CreatorAvatar, avatarStore) stay unmapped on purpose,
      // so touching them still runs everything.
      "app/api/lists/",
      "app/(public)/l/",
      "app/api/l/",
      "app/api/admin/migrate-list-approval/",
      "app/api/cron/refresh-roster-profiles/",
      "app/api/admin/migrate-creator-roster/",
      // K4: the consent record behind every agency read of a connection.
      "app/api/admin/migrate-creator-grants/",
      "app/api/admin/backfill-creator-grants/",
      "components/creators/CreatorAccess.tsx",
      "app/api/admin/migrate-creator-account-ids/",
      "components/creators/CreatorName.tsx",
      "components/creators/ExportMenu.tsx",
      "components/creators/HandleFix.tsx",
      "components/creators/ImportCreatorsModal.tsx",
      "components/creators/MergeCreatorModal.tsx",
      "components/creators/PlatformChips.tsx",
      "components/creators/RosterActions.tsx",
      // Track all / Track selected on the roster (plan §04); the endpoint
      // itself is app/api/trackers/, under settings.
      "components/creators/TrackCreators.tsx",
      "components/creators/InstagramDiscoveryPanel.tsx",
      "components/lists/",
      "lib/lists/",
      "lib/creators/creatorName.ts",
      "lib/creators/handleCheck.ts",
      "lib/creators/importCreators.ts",
      "lib/creators/importParse.ts",
      "lib/creators/importParseLegacy.ts",
      "lib/creators/mergeCreators.ts",
      "lib/creators/rosterAudit.ts",
      "lib/creators/resolvePostLinks.ts",
      "app/api/admin/roster-audit/",
      "lib/creators/profileRefresh.ts",
      "lib/creators/rosterExport.ts",
      "lib/creators/rosterSchemaDdl.ts",
      "lib/creators/rosterSelection.ts",
      "lib/creators/rosterTables.ts",
      // Mapped 2026-10-13 from the import graph (see campaigns above).
      "app/(public)/c/",
      "app/api/media-kits/",
      "app/api/kit/",
      "app/api/diagnostics/",
      "app/api/cron/refresh-creator-avatars/",
      "app/api/admin/migrate-creator-avatars/",
      "app/api/admin/migrate-creator-accounts/",
      "app/api/admin/migrate-account-identity/",
    ],
  },
  portal: {
    specs: [
      "portal-dashboard.spec.ts",
      "portal-discover.spec.ts",
      "shared-links.spec.ts",
    ],
    sources: [
      "app/(portal)/",
      "app/api/portal/",
      "components/portal/",
      // A roster creator's connect link and the connection lifecycle behind it
      // (K1-K3, K5): the public page, its tables, the deauthorize webhooks.
      "app/(public)/connect/",
      "app/api/admin/migrate-creator-connect/",
      "app/api/webhooks/tiktok/",
      "app/api/webhooks/meta/",
      "lib/portal/",
      "lib/oauth/",
      "app/(public)/invite/",
      "app/(public)/data-deletion/",
      // Mapped 2026-10-13 from the import graph (see campaigns above).
      "app/api/campaign-invites/",
      "app/api/cron/auto-approve-submissions/",
      "app/api/cron/refresh-platform-tokens/",
      // The legal pages the connect and portal flows link to.
      "app/(public)/privacy/",
      "app/(public)/terms/",
      "app/(public)/about/",
    ],
  },
  marketplace: {
    specs: ["marketplace-funnel.spec.ts", "negotiation.spec.ts"],
    sources: [
      "app/(dashboard)/requests/",
      "app/(dashboard)/plans/",
      "app/api/marketplace/",
      "app/api/proposals/",
      // Mapped 2026-10-13 from the import graph (see campaigns above).
      "app/(public)/explore/",
      "app/api/public/marketplace/",
      "app/api/negotiations/",
      "app/api/plans/",
      "app/api/payout-requests/",
    ],
  },
  settings: {
    specs: [
      "settings.spec.ts",
      "audit-log.spec.ts",
      "trackers.spec.ts",
    ],
    sources: [
      "app/(dashboard)/settings/",
      "app/(dashboard)/connections/",
      "app/(dashboard)/audit-log/",
      "app/(dashboard)/clients/",
      "app/(dashboard)/trackers/",
      "app/api/trackers/",
      "app/(dashboard)/payouts/",
      "app/(dashboard)/admin/",
      "app/api/settings/",
      "app/api/admin/migrate-platform-credentials/",
      "lib/platforms/platformCredentialDdl.ts",
      "lib/trackers/",
      // Reader v2 and its switch (plan §07): the cron, the ops page and its API,
      // the Plan B health intake and its DDL route.
      "app/api/cron/read-creator-trackers/",
      "app/api/cron/sync-creator-trackers/",
      "app/(dashboard)/platform/trackers/",
      "app/api/platform/tracker-source/",
      "app/api/admin/migrate-tracker-sources/",
      // Ops guards (plan §13 C and M): kill switches, heartbeats, breakers, the
      // Sandbox cap and meters, their crons, the ops page, its API and DDL route.
      "lib/ops/",
      "app/api/cron/ops-canary/",
      "app/api/cron/ops-meters/",
      "app/(dashboard)/platform/ops/",
      "app/api/platform/ops/",
      "app/api/admin/migrate-ops-guards/",
      // Backups (plan §13 B): the overdue-crons list the Plan B backup
      // scheduler polls, and the DDL route for the API quota counter.
      "app/api/ops/",
      "app/api/admin/migrate-ops-quota/",
      // Mapped 2026-10-13 from the import graph (see campaigns above).
      "app/api/audit-logs/",
      "app/api/clients/",
      "app/api/connections/",
      "app/api/email-logs/",
      "app/api/ingestion/",
      "app/api/keys/",
      "app/api/org/",
      "app/api/payouts/",
      "app/api/recipients/",
      "app/(dashboard)/recipients/",
      "app/api/team/",
      "app/api/invites/",
      "app/api/notifications/",
      "app/api/cron/snapshot-sounds/",
      "app/api/cron/sync-trackers/",
      // A sound's stored cover: the trackers page, the campaigns list and the audio card read it.
      "app/api/sounds/",
      "app/api/admin/migrate-sound-covers/",
      "app/api/admin/upload-sound-cover/",
      // Stored campaign pictures: the table, and the one-off copy of the backlog.
      "app/api/admin/migrate-campaign-thumbnails/",
      "app/api/admin/backfill-artwork/",
      "app/api/admin/migrate-tracker-indexes/",
      "app/api/admin/instagram-access/",
      "app/api/admin/integration-health/",
      // The operator's own pages; platform/trackers, /ops and /feedback are mapped above and below.
      "app/(dashboard)/platform/page.tsx",
      "app/(dashboard)/platform/PlatformDashboardClient.tsx",
      "app/api/platform/orgs/",
      "app/api/platform/stats/",
      "app/api/platform/act-as/",
      "app/api/platform/canary/",
      "app/api/platform/instagram-token/",
    ],
  },
  /* The Feedback button (every client and creator page) and the operator's
     inbox at /platform/feedback, with their API, DDL route and helpers. */
  feedback: {
    specs: ["feedback.spec.ts"],
    sources: [
      "components/feedback/",
      "lib/feedback/",
      "app/api/feedback/",
      "app/api/platform/feedback/",
      "app/(dashboard)/platform/feedback/",
      "app/api/admin/migrate-feedback/",
    ],
  },
  nav: {
    specs: ["navigation.spec.ts"],
    sources: [
      "components/layout/",
      "components/NewSidebar.tsx",
      // /inbox is parked behind a redirect that navigation.spec.ts asserts; the bell in the top bar reads notifications.
      "app/(dashboard)/inbox/",
      "app/api/messages/",
      "app/api/notifications/",
    ],
  },
  responsive: {
    specs: ["responsive-a.spec.ts", "responsive-b.spec.ts", "responsive-c.spec.ts", "responsive-d.spec.ts"],
    sources: [],
  },
  /* Like `responsive`, this area has no `sources` of its own: the things that
     break text contrast -- the theme blocks in globals.css and the shared
     components in components/ds/ -- are already CROSS_CUTTING below, so a diff
     touching them runs the whole suite including this. The entry exists so the
     spec is reachable by name and shows up in --list. */
  contrast: {
    specs: ["contrast.spec.ts"],
    sources: [],
  },
  /* The action registry. Unlike `contrast` this one DOES have a source of its
     own -- the registry file itself -- because deleting an id from ACTIONS
     type-checks everywhere the id is no longer used and silently breaks every
     theme rule that still names it. globals.css and components/ds/ reach it
     through CROSS_CUTTING, as above. */
  actions: {
    specs: ["action-registry.spec.ts"],
    sources: ["lib/ui/actions.ts"],
  },
  /* Songs: the catalogue page, a song's own page and their API. Their spec is
     shared-links.spec.ts, which opens /songs/[id] in an org of its own; it is
     also listed under creators and portal, for the shared list, the connect
     link and the campaign invitation it opens. */
  songs: {
    specs: ["shared-links.spec.ts"],
    sources: ["app/(dashboard)/songs/", "app/api/songs/"],
  },
};

/**
 * Shared lib/ and components/ files, keyed by path, with the areas whose
 * routes import them. Merged into AREAS[area].sources below, so every reader
 * of the map sees ordinary sources.
 *
 * Derived 2026-10-13 from the import graph, not by name: for each file, every
 * page, layout and route handler that reaches it through imports, and the
 * areas those entry points belong to. A file is listed only when
 *   - every entry point that reaches it is itself mapped (nothing through
 *     app/(dashboard)/layout.tsx, app/layout.tsx, app/api/img, app/api/sdui or
 *     app/api/tenant, which render on or serve every screen), and
 *   - it reaches at most three areas.
 * Past three it is shared infrastructure in practice -- lib/metrics/numbers
 * and lib/metrics/costs reach six, lib/creators/connectionGate four, lib/brand
 * every one -- and stays unmapped, which means the full suite. That also keeps
 * contrast and responsive in play for anything wide: those two specs open
 * screens in every area but own no sources, so an area run never includes
 * them.
 *
 * A file imported by nothing (lib/ai/* apart from the two below,
 * components/ai/*, lib/payments/*) is not listed either; touching it runs
 * everything, which costs time and never coverage.
 *
 * When a new importer pulls one of these into another area, add the area
 * here. Nothing checks this automatically: the cost of a stale row is an area
 * run that misses the new screen, so re-derive it when moving code between
 * areas.
 */
const IMPORTED_BY = {
  "components/CreatorSelect.tsx": ["campaigns"],
  "components/PostMedia.tsx": ["campaigns"],
  "components/RichTextEditor.tsx": ["campaigns"],
  "components/modals/CampaignWizard.tsx": ["campaigns"],
  "components/modals/AddCreatorModal.tsx": ["creators"],
  "components/modals/AddClientModal.tsx": ["settings"],
  "components/modals/AddPayoutModal.tsx": ["settings"],
  "components/modals/ClientFeatureModal.tsx": ["settings"],
  "components/modals/PayoutDetailModal.tsx": ["settings"],
  "components/integrations/": ["settings"],
  "components/creators/MetricFigure.tsx": ["creators", "settings"],
  "components/insights/": ["creators", "portal"],
  "components/LegalLinks.tsx": ["portal"],
  "components/LegalShell.tsx": ["portal"],

  "lib/activationQueues.ts": ["analytics", "campaigns"],
  "lib/ai/models.ts": ["campaigns"],
  "lib/ai/outreach/": ["campaigns"],
  "lib/analytics/": ["analytics", "campaigns", "songs"],
  "lib/api/errorMessage.ts": ["campaigns", "creators", "settings"],
  "lib/campaignActivity.ts": ["campaigns"],
  "lib/campaignArtwork.ts": ["analytics", "campaigns"],
  "lib/campaignScope.ts": ["campaigns", "settings"],
  "lib/campaigns/": ["campaigns", "settings"],
  "lib/capabilities.ts": ["portal"],
  "lib/compliance/": ["campaigns"],
  "lib/creatorcore/": ["campaigns"],
  "lib/creatorMetrics.ts": ["analytics", "creators"],
  "lib/features.ts": ["marketplace", "settings"],
  "lib/fraud-detection.ts": ["campaigns"],
  "lib/fraud/": ["campaigns"],
  "lib/health/": ["settings"],
  "lib/http/readCache.ts": ["analytics"],
  "lib/integrations/": ["campaigns", "settings"],
  "lib/inviteEmail.ts": ["settings"],
  "lib/listFilters.ts": ["campaigns", "creators", "settings"],
  "lib/listPageSize.ts": ["campaigns", "creators"],
  "lib/listParams.ts": ["campaigns", "creators", "settings"],
  "lib/useListQuery.ts": ["campaigns", "creators"],
  // lib/marketplace.ts and lib/marketplace/ both.
  "lib/marketplace": ["campaigns", "marketplace", "portal"],
  "lib/mcp/": ["campaigns"],
  "lib/messaging/": ["nav", "portal"],
  "lib/metrics/benchmarks.ts": ["analytics", "campaigns", "songs"],
  "lib/metrics/index.ts": ["analytics", "campaigns", "songs"],
  "lib/metrics/trend.ts": ["analytics", "campaigns", "songs"],
  "lib/negotiation/": ["marketplace", "portal"],
  "lib/payouts/": ["settings"],
  "lib/platform/stats.ts": ["settings"],
  "lib/postRemoval.ts": ["analytics", "campaigns", "creators"],
  "lib/recipients/": ["settings"],
  "lib/refreshCooldown.ts": ["campaigns", "settings"],
  "lib/refreshSummary.ts": ["campaigns", "settings"],
  "lib/reports/": ["analytics", "campaigns"],
  "lib/serialization/": ["campaigns"],
  "lib/sounds/": ["analytics", "campaigns", "settings"],
  "lib/syncSlot/": ["campaigns"],
  "lib/taxonomy.ts": ["settings"],
  "lib/team/": ["settings"],
  "lib/tenantRefs.ts": ["analytics", "campaigns"],

  // lib/creators/: the files no hand-written entry above already covers.
  "lib/creators/accountIds.ts": ["creators", "settings"],
  "lib/creators/accountIdSchemaDdl.ts": ["creators", "settings"],
  "lib/creators/accountIdTables.ts": ["creators", "settings"],
  "lib/creators/agencyLookup.ts": ["creators"],
  "lib/creators/avatarResponse.ts": ["analytics", "creators"],
  "lib/creators/avatarSchemaDdl.ts": ["creators"],
  "lib/creators/avatarStore.ts": ["analytics", "creators", "settings"],
  "lib/creators/connectedReading.ts": ["settings"],
  "lib/creators/connectSchemaDdl.ts": ["creators", "portal", "settings"],
  "lib/creators/connectTables.ts": ["creators", "portal", "settings"],
  "lib/creators/connectToken.ts": ["creators", "portal"],
  "lib/creators/figureTime.ts": ["creators"],
  "lib/creators/forgetConnectedReadings.ts": ["portal"],
  "lib/creators/grantAccess.ts": ["creators"],
  "lib/creators/grantBackfill.ts": ["creators"],
  "lib/creators/grants.ts": ["creators", "portal"],
  "lib/creators/latestReadings.ts": ["creators"],
  "lib/creators/metricValue.ts": ["campaigns", "creators", "settings"],
  "lib/creators/platformTabs.ts": ["creators"],
  "lib/creators/rosterMetrics.ts": ["creators"],
  "lib/creators/snapshot.ts": ["settings"],
  "lib/creators/topPosts.ts": ["settings"],
  "lib/creators/topPostsFromCampaigns.ts": ["settings"],

  // lib/posts/: unattributedCreator and unattributedName reach five areas and stay unmapped.
  "lib/posts/addPostChecks.ts": ["campaigns", "portal", "settings"],
  "lib/posts/bulkActions.ts": ["campaigns"],
  "lib/posts/bulkAdd.ts": ["campaigns"],
  "lib/posts/detectCreator.ts": ["campaigns", "portal", "settings"],
  "lib/posts/duplicates.ts": ["analytics", "campaigns", "songs"],
  "lib/posts/fieldFreshness.ts": ["campaigns"],
  "lib/posts/pastedUrls.ts": ["campaigns"],
  "lib/posts/postDisplay.ts": ["campaigns"],
  "lib/posts/postStatus.ts": ["analytics", "campaigns", "creators"],
};

for (const [path, areas] of Object.entries(IMPORTED_BY)) {
  for (const area of areas) {
    /* A misspelt area would otherwise drop the path silently -- and an
       unmapped path is safe, but a half-mapped one runs too little. */
    if (!AREAS[area]) throw new Error(`e2e/areas.mjs: IMPORTED_BY names unknown area "${area}" for ${path}`);
    if (!AREAS[area].sources.includes(path)) AREAS[area].sources.push(path);
  }
}

/**
 * Paths that can change how any page renders or how every query behaves. A
 * touch here means the whole suite, no matter how small the diff looks -- the
 * number-formatting pass that prompted all this was four lines in lib/format.ts
 * and changed every figure on every screen.
 */
export const CROSS_CUTTING = [
  "lib/format",
  /* How every metric reads -- "--" versus 0, the unit, the precision. 55
     routes in six areas import it, and contrast and responsive score the
     figures it produces on every screen without owning a source of their own.
     It would force the full suite as an unmapped path anyway; it is named here
     so nobody maps it to an area later because it looks like one feature's. */
  "lib/metricDisplay",
  "lib/db",
  "lib/prisma",
  "components/ds/",
  "components/ui/",
  "app/globals.css",
  "app/layout.tsx",
  "proxy.ts",
  "prisma/",
  "package.json",
  "package-lock.json",
  "playwright.config.ts",
  "next.config",
  "tsconfig.json",
  "e2e/helpers.ts",
  "e2e/areas.mjs",
  "e2e/fixtures/",
  "scripts/e2e-area.mjs",
];

/** Paths that cannot change what the app renders, so they force nothing. */
export const INERT = [
  "__tests__/", "docs/", "README", ".gitignore", "scratchpad/", ".vscode/",
  "scripts/creator-worker/", "scripts/trackers/", "scripts/qa/",
  /* CI, lint and unit-test configuration, and the agent notes: none of them is
     loaded by the app. vercel.json is read by Vercel's platform (crons,
     regions), never by the `next start` the suite runs against, so no E2E run
     can observe a change to it. */
  ".github/", "CLAUDE.md", "eslint.config.mjs", "scripts/lint-ratchet", "jest.", "vercel.json",
];

export const AREA_NAMES = Object.keys(AREAS);

/**
 * Which areas a set of changed paths touches.
 * Returns { areas: string[], full: boolean, reason: string }.
 * `full` means: run everything, and it is the answer whenever a path is
 * cross-cutting OR matches nothing we know about.
 */
export function affectedAreas(paths) {
  const areas = new Set();
  const unknown = [];
  let crossCutting = null;

  for (const raw of paths) {
    const p = raw.trim();
    if (!p) continue;
    if (INERT.some((i) => p.startsWith(i) || p.includes("/" + i))) continue;
    if (CROSS_CUTTING.some((c) => p.startsWith(c) || p.includes("/" + c))) {
      crossCutting ??= p;
      continue;
    }
    if (p.startsWith("e2e/")) {
      const spec = p.slice(4);
      const owner = AREA_NAMES.find((a) => AREAS[a].specs.includes(spec));
      if (owner) areas.add(owner);
      else unknown.push(p);
      continue;
    }
    const hit = AREA_NAMES.filter((a) => AREAS[a].sources.some((s) => p.startsWith(s)));
    if (hit.length) hit.forEach((a) => areas.add(a));
    else unknown.push(p);
  }

  if (crossCutting) return { areas: [], full: true, reason: `cross-cutting change: ${crossCutting}` };
  if (unknown.length)
    return { areas: [], full: true, reason: `unmapped path (treated as cross-cutting): ${unknown[0]}` };
  if (!areas.size) return { areas: [], full: false, reason: "no app code changed" };
  return { areas: [...areas].sort(), full: false, reason: "" };
}
