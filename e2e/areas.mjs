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
    specs: ["auth.spec.ts", "signup-org-types.spec.ts", "portal-auth.spec.ts"],
    sources: ["app/(auth)/", "app/api/auth/", "app/onboarding/", "lib/auth"],
  },
  campaigns: {
    specs: [
      "campaigns.spec.ts",
      "campaigns-detail.spec.ts",
      "campaigns-proposals.spec.ts",
      "activations.spec.ts",
      "deadlines.spec.ts",
      "calendar.spec.ts",
    ],
    sources: [
      "app/(dashboard)/campaigns/",
      "app/(dashboard)/activations/",
      "app/(dashboard)/deadlines/",
      "app/(dashboard)/calendar/",
      "app/api/campaigns/",
      "components/campaigns/",
      "components/posts/",
      "lib/sync/",
    ],
  },
  analytics: {
    specs: ["gate2-dashboard.spec.ts", "dashboard.spec.ts", "financial-reports.spec.ts"],
    sources: [
      "app/(dashboard)/analytics/",
      "app/(dashboard)/dashboard/",
      "app/(dashboard)/reports/",
      "app/(dashboard)/financial-reports/",
      "app/(public)/share/",
      "app/api/analytics/",
      "app/api/share/",
      "components/charts/",
    ],
  },
  creators: {
    specs: [
      "creators.spec.ts",
      "creators-detail.spec.ts",
      "lists.spec.ts",
      "discovery.spec.ts",
      "public-profile.spec.ts",
    ],
    sources: [
      "app/(dashboard)/creators/",
      "app/(dashboard)/lists/",
      "app/(dashboard)/discovery/",
      "app/(dashboard)/fan-pages/",
      "app/(dashboard)/media-kits/",
      "app/api/creators/",
      "app/api/discovery/",
      "lib/platforms/",
    ],
  },
  portal: {
    specs: [
      "portal-dashboard.spec.ts",
      "portal-discover.spec.ts",
      "portal-proposals.spec.ts",
      "portal-reviews.spec.ts",
    ],
    sources: ["app/(portal)/", "app/api/portal/", "components/portal/"],
  },
  marketplace: {
    specs: ["marketplace-funnel.spec.ts", "negotiation.spec.ts", "self-serve-wizard.spec.ts"],
    sources: [
      "app/(dashboard)/requests/",
      "app/(dashboard)/plans/",
      "app/api/marketplace/",
      "app/api/proposals/",
    ],
  },
  messaging: {
    specs: ["messaging.spec.ts", "recipients.spec.ts"],
    sources: [
      "app/(dashboard)/inbox/",
      "app/(dashboard)/recipients/",
      "app/api/messages/",
      "lib/email",
    ],
  },
  settings: {
    specs: [
      "settings.spec.ts",
      "connections.spec.ts",
      "audit-log.spec.ts",
      "clients.spec.ts",
      "trackers.spec.ts",
      "payouts.spec.ts",
    ],
    sources: [
      "app/(dashboard)/settings/",
      "app/(dashboard)/connections/",
      "app/(dashboard)/audit-log/",
      "app/(dashboard)/clients/",
      "app/(dashboard)/trackers/",
      "app/(dashboard)/payouts/",
      "app/(dashboard)/admin/",
      "app/api/settings/",
      "lib/trackers/",
    ],
  },
  nav: {
    specs: ["navigation.spec.ts"],
    sources: ["components/layout/", "components/NewSidebar.tsx"],
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
};

/**
 * Paths that can change how any page renders or how every query behaves. A
 * touch here means the whole suite, no matter how small the diff looks -- the
 * number-formatting pass that prompted all this was four lines in lib/format.ts
 * and changed every figure on every screen.
 */
export const CROSS_CUTTING = [
  "lib/format",
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
export const INERT = ["__tests__/", "docs/", "README", ".gitignore", "scratchpad/", ".vscode/"];

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
