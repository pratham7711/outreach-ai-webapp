/**
 * Resolve the theme a request should be served, layered:
 *
 *     checked-in default   <   org override
 *
 * resolveOrgTheme NEVER THROWS. A DB outage, a corrupt row, a token that no
 * longer exists -- every one of them lands on the checked-in default, because a
 * broken theme row must degrade to the shipped look rather than to an unstyled
 * page. Every rejection is recorded and surfaced by the debug view instead of
 * being swallowed.
 *
 * The checked-in default is empty: light and dark are globals.css as shipped.
 * It used to be lib/sdui/defaults/creatorcore.theme.json, which carried only
 * the CreatorCore theme's tokens and went with that theme in November 2026.
 */
import { db } from "@/lib/db";
import { storedThemeSchema, type StoredTheme } from "./contract";
import { emitThemeCss, type ResponsiveLayer, type ThemeMode } from "./emit";

export type ResolvedTheme = {
  css: string;
  applied: Record<string, string>;
  rejected: { token: string; reason: string }[];
  /** Which layer each mode's values came from -- the provenance the debug view shows. */
  source: Record<string, "file" | "org">;
  /** Cache stamp. Changing the org's config bumps this, which is what makes a
   *  publish visible without a deploy. */
  version: number;
  degraded: boolean;
};

const FILE_THEME: StoredTheme = storedThemeSchema.parse({});

function mergeModes(
  base: StoredTheme,
  over: StoredTheme | null,
): { modes: Partial<Record<ThemeMode, Record<string, unknown>>>; source: Record<string, "file" | "org"> } {
  const modes: Partial<Record<ThemeMode, Record<string, unknown>>> = {};
  const source: Record<string, "file" | "org"> = {};
  for (const mode of ["light", "dark"] as const) {
    const b = base.modes?.[mode] ?? {};
    const o = over?.modes?.[mode] ?? {};
    const merged: Record<string, unknown> = { ...b, ...o };
    if (Object.keys(merged).length) modes[mode] = merged;
    for (const k of Object.keys(merged)) source[`${mode} ${k}`] = k in o ? "org" : "file";
  }
  return { modes, source };
}

export async function resolveOrgTheme(
  orgId: string | null | undefined,
  /* The caller's already-loaded uiConfig, when it has one. The dashboard layout
     does: it reads entitlements (uiConfig included) two lines above rendering
     <ThemeStyle>, and querying the same organization row a second time on every
     page render is a cost with nothing to show for it. Omitted, this falls back
     to its own read -- the API route has no entitlements in hand. */
  uiConfig?: Record<string, unknown> | null,
): Promise<ResolvedTheme> {
  let stored: StoredTheme | null = null;
  let degraded = false;
  let version = FILE_THEME.version;

  if (orgId) {
    try {
      /* orgId comes from the session at the call site and is an ARGUMENT here --
         it is never read from a request body, and the config supplies no part of
         this query. */
      const config = uiConfig !== undefined
        ? uiConfig
        : ((await db.organization.findUnique({
            where: { id: orgId },
            select: { uiConfig: true },
          }))?.uiConfig as Record<string, unknown> | null);
      const raw = config?.theme;
      if (raw) {
        const parsed = storedThemeSchema.safeParse(raw);
        if (parsed.success) {
          stored = parsed.data;
          version = parsed.data.version;
        } else {
          degraded = true;
        }
      }
    } catch {
      /* A theme is not worth failing a page render for. */
      degraded = true;
    }
  }

  /* The org's brand colour used to be folded in here as --cc-primary on every
     mode. It is gone (October 2026): the themes own the app's colours, and a
     brand colour on Light's black controls is exactly the drift they exist to
     prevent. */
  const { modes, source } = mergeModes(FILE_THEME, stored);
  /* Responsive layers merge BY BREAKPOINT, so an org retuning the >=1024 shell
     replaces that layer's tokens without silently dropping the file's other
     breakpoints. */
  const byMin = new Map<number, ResponsiveLayer>();
  for (const layer of [...(FILE_THEME.responsive ?? []), ...(stored?.responsive ?? [])]) {
    const prev = byMin.get(layer.minWidth);
    byMin.set(layer.minWidth, {
      minWidth: layer.minWidth,
      modes: {
        light: { ...(prev?.modes.light ?? {}), ...(layer.modes.light ?? {}) },
        dark: { ...(prev?.modes.dark ?? {}), ...(layer.modes.dark ?? {}) },
      },
    });
  }
  const { css, applied, rejected } = emitThemeCss(modes, [...byMin.values()]);
  return { css, applied, rejected, source, version, degraded };
}
