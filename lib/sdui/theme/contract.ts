/**
 * The closed set of tokens a backend may drive, and what a legal value is.
 *
 * Closed on purpose. A theme arriving from the database is UNTRUSTED DATA: it is
 * assembled into a <style> element, so an open token map is a CSS-injection
 * surface. Two rules make that safe and both are enforced here rather than at
 * the call site:
 *
 *   1. A token name not in this table is dropped. Names are never taken from
 *      input, only matched against it.
 *   2. A value is never passed through. It is PARSED into a typed shape and
 *      then RE-SERIALISED from that shape, so the characters that could end a
 *      declaration or open a new one (`}` `<` `;` `:` `url(` `@import`) cannot
 *      survive, because nothing but digits, a unit keyword or a hex triple is
 *      ever written back out.
 *
 * Adding a token here is a deliberate act: it widens what a tenant can change.
 */
import { z } from "zod";

export type TokenKind = "color" | "length" | "number" | "keyword";

export type TokenSpec = {
  kind: TokenKind;
  /** Units a length may use. Anything else is rejected, `calc()` included. */
  units?: readonly string[];
  /** Allowed values when kind is "keyword". */
  values?: readonly string[];
  min?: number;
  max?: number;
  /** Why this token exists and, where it came from a measurement, which one. */
  note: string;
};

/** Units we accept. No `calc`, no `var`, no `env` -- those are expressions, and
 *  an expression is a place to hide something. */
export const LENGTH_UNITS = ["px", "rem", "em", "%", "vw", "vh", "ch"] as const;

export const TOKEN_CONTRACT = {
  // ---- colour -------------------------------------------------------------
  "--cc-primary": { kind: "color", note: "brand accent; the one token white-label already drove" },
  "--cc-sidebar": { kind: "color", note: "rail surface" },
  "--cc-bg": { kind: "color", note: "app background" },
  "--cc-surface": { kind: "color", note: "card surface" },
  "--cc-border": { kind: "color", note: "hairline colour" },
  "--cc-text": { kind: "color", note: "body ink" },
  "--cc-text-subtle": { kind: "color", note: "secondary ink" },

  // ---- the shell, in RATIOS, because CreatorCore's is proportional ---------
  // MEASURED at two viewports, identical ratios at both:
  //   rail 15.00% | rail inset 0.625% | reserved 15.31% | page pad 3.40%
  // -> rail 240/216, x 10/9, content x 291/262, width 1263/1136.5 at 1600/1440.
  "--cc-sidebar-w": { kind: "length", units: LENGTH_UNITS, note: "reserved rail column (measured 15.31% on CreatorCore)" },
  "--cc-sidebar-w-collapsed": { kind: "length", units: LENGTH_UNITS, note: "reserved column when collapsed" },
  "--cc-rail-card-w": { kind: "length", units: LENGTH_UNITS, note: "the rail card itself (measured 15.00%)" },
  "--cc-rail-inset-x": { kind: "length", units: LENGTH_UNITS, note: "air either side of the rail card (measured 0.625%)" },
  "--cc-page-pad-inline": { kind: "length", units: LENGTH_UNITS, note: "page gutter (measured 3.40% of the content column)" },

  // ---- controls -----------------------------------------------------------
  // MEASURED: every CreatorCore page-level primary action is the same box
  // regardless of label -- and that box is a RATIO of the viewport above the
  // desktop breakpoint (11.25vw x 2.5vw on the dashboard shell: 180x40 at 1600,
  // 162x36 at 1440, both exactly 0.9), falling back to a fixed 180x40 below it.
  // Ours was content-width x 30. The type does not scale with the box: 18px/400
  // at every desktop width.
  "--cc-action-min-w": { kind: "length", units: LENGTH_UNITS, note: "primary action width (11.25vw desktop, 180px floor)" },
  "--cc-action-h": { kind: "length", units: LENGTH_UNITS, note: "primary action height (2.5vw desktop, 40px floor)" },
  "--cc-action-fs": { kind: "length", units: LENGTH_UNITS, note: "primary action type size (measured 18px)" },
  "--cc-action-fw": { kind: "number", min: 100, max: 900, note: "primary action weight (measured 400)" },
  "--cc-action-fg": { kind: "color", note: "primary action label (measured #ffffff)" },
  "--cc-control-h": { kind: "length", units: LENGTH_UNITS, note: "default control height" },

  // ---- radii --------------------------------------------------------------
  "--ui-r-sm": { kind: "length", units: LENGTH_UNITS, note: "small chrome radius (CreatorCore 4px)" },
  "--ui-r-md": { kind: "length", units: LENGTH_UNITS, note: "button radius (CreatorCore 10px)" },
  "--ui-r-lg": { kind: "length", units: LENGTH_UNITS, note: "card radius (CreatorCore 20px)" },
  "--cc-r-card": { kind: "length", units: LENGTH_UNITS, note: "card radius for surfaces that set it inline" },

  // ---- type ---------------------------------------------------------------
  "--cc-fs-page-title": { kind: "length", units: LENGTH_UNITS, note: "page title size (CreatorCore 24px at 1440)" },
  "--cc-fw-page-title": { kind: "number", min: 100, max: 900, note: "page title weight (CreatorCore 700)" },
  "--cc-density": { kind: "number", min: 0.5, max: 2, note: "multiplies the whole spacing ramp" },
} as const satisfies Record<string, TokenSpec>;

export type TokenName = keyof typeof TOKEN_CONTRACT;
export const TOKEN_NAMES = Object.keys(TOKEN_CONTRACT) as TokenName[];

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LENGTH = /^(-?\d+(?:\.\d+)?)(px|rem|em|%|vw|vh|ch)$/;

/**
 * Parse-then-reserialise. Returns the canonical string to write, or null.
 * Never returns any part of `raw` verbatim.
 */
export function canonicalise(name: string, raw: unknown): string | null {
  const spec = (TOKEN_CONTRACT as Record<string, TokenSpec>)[name];
  if (!spec) return null;
  if (typeof raw === "number" && spec.kind === "number") raw = String(raw);
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (v.length > 32) return null;

  switch (spec.kind) {
    case "color": {
      if (!HEX.test(v)) return null;
      // Re-emit from the captured digits only, normalised to 6-digit lower case.
      const h = v.slice(1).toLowerCase();
      const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
      return `#${full}`;
    }
    case "length": {
      const m = LENGTH.exec(v);
      if (!m) return null;
      const n = Number(m[1]);
      if (!Number.isFinite(n)) return null;
      if (!(spec.units ?? LENGTH_UNITS).includes(m[2])) return null;
      return `${n}${m[2]}`;
    }
    case "number": {
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      if (spec.min != null && n < spec.min) return null;
      if (spec.max != null && n > spec.max) return null;
      return String(n);
    }
    case "keyword": {
      return (spec.values ?? []).includes(v) ? v : null;
    }
  }
}

/** Shape of a stored theme. `.strip()` so an unknown key from a NEWER writer is
 *  dropped rather than failing the whole theme -- the rollback rule from the
 *  plan, applied to themes as well as widgets. */
export const themeOverridesSchema = z.record(z.string(), z.union([z.string(), z.number()]));
export const storedThemeSchema = z
  .object({
    version: z.number().int().min(1).default(1),
    label: z.string().max(80).optional(),
    /* One row carries every mode, so a tenant's light and creatorcore themes
       cannot drift apart in separate records. Each mode is OPTIONAL: a record
       keyed by an enum would demand all three be present, and a theme that only
       retunes creatorcore is the common case. */
    modes: z
      .object({
        light: themeOverridesSchema.optional(),
        dark: themeOverridesSchema.optional(),
        creatorcore: themeOverridesSchema.optional(),
      })
      .default({}),
    /* Breakpoint-scoped re-points. Necessary, not a nicety: the measured
       CreatorCore shell is 15% of the viewport, and 15% of a 390px phone is a
       58px rail. Their rail is not in the DOM at all below 1024, so the ratios
       are only correct above it -- a theme system that can only emit
       unconditional tokens cannot express that, and would ship a broken phone
       layout to state a correct desktop one.

       minWidth only: max-width blocks invite overlapping ranges where the
       winner depends on source order, which is exactly the kind of thing that
       is impossible to debug from a database row. */
    responsive: z
      .array(
        z.object({
          minWidth: z.number().int().min(320).max(2560),
          modes: z
            .object({
              light: themeOverridesSchema.optional(),
              dark: themeOverridesSchema.optional(),
              creatorcore: themeOverridesSchema.optional(),
            })
            .default({}),
        }),
      )
      .max(6)
      .default([]),
  })
  .strip();

export type StoredTheme = z.infer<typeof storedThemeSchema>;
