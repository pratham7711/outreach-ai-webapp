/**
 * Turn a resolved token map into a <style> body.
 *
 * Every character written here comes from this file or from canonicalise(), and
 * canonicalise() re-serialises from a parsed shape rather than echoing input --
 * so `}`, `<`, `url(` and `@import` cannot reach the output no matter what the
 * database holds. The token NAME is likewise never taken from input: it is
 * matched against the contract and the contract's own key is what gets written.
 *
 * The selector matters as much as the content. The seam this replaces wrote
 * --cc-primary as an INLINE style on the dashboard root, and an inline custom
 * property out-specifies both .dark and .creatorcore -- so an org's brand colour
 * leaked into dark mode. At one token that is a cosmetic bug; at twenty it is
 * guaranteed. Emitting :root.<mode> puts tenant values on exactly the same
 * footing as the stylesheet's own theme blocks, where the cascade can resolve
 * them normally.
 */
import { TOKEN_CONTRACT, canonicalise, type TokenName } from "./contract";

export type ThemeMode = "light" | "dark" | "creatorcore";

/** `:root.dark` / `:root.creatorcore`; light is the bare `:root` base. */
function selectorFor(mode: ThemeMode): string {
  return mode === "light" ? ":root" : `:root.${mode}`;
}

export type EmitResult = {
  css: string;
  applied: Record<string, string>;
  rejected: { token: string; reason: string }[];
};

export type ResponsiveLayer = {
  minWidth: number;
  modes: Partial<Record<ThemeMode, Record<string, unknown>>>;
};

export function emitThemeCss(
  byMode: Partial<Record<ThemeMode, Record<string, unknown>>>,
  responsive: ResponsiveLayer[] = [],
): EmitResult {
  const blocks: string[] = [];
  const applied: Record<string, string> = {};
  const rejected: { token: string; reason: string }[] = [];
  const emitModes = (
    src: Partial<Record<ThemeMode, Record<string, unknown>>>,
    prefix: string,
  ) => {
    const out: string[] = [];
    for (const mode of ["light", "dark", "creatorcore"] as const) {
      const overrides = src[mode];
      if (!overrides) continue;
      const decls: string[] = [];
      for (const rawName of Object.keys(overrides)) {
        const name = (Object.keys(TOKEN_CONTRACT) as TokenName[]).find((t) => t === rawName);
        if (!name) {
          rejected.push({ token: rawName, reason: "not in the token contract" });
          continue;
        }
        const value = canonicalise(name, overrides[rawName]);
        if (value == null) {
          rejected.push({ token: rawName, reason: "value failed its type's parse" });
          continue;
        }
        decls.push(`${name}:${value}`);
        applied[`${prefix}${mode} ${name}`] = value;
      }
      if (decls.length) out.push(`${selectorFor(mode)}{${decls.join(";")}}`);
    }
    return out;
  };

  blocks.push(...emitModes(byMode, ""));
  /* Ascending, so a wider breakpoint always comes later in the sheet and wins
     at equal specificity -- the same order a hand-written stylesheet uses. The
     number is an integer from the schema and is written with String(), so the
     media query cannot be a place to inject either. */
  for (const layer of [...responsive].sort((a, b) => a.minWidth - b.minWidth)) {
    const inner = emitModes(layer.modes, `@${layer.minWidth} `);
    if (inner.length) blocks.push(`@media (min-width:${String(Math.trunc(layer.minWidth))}px){${inner.join("")}}`);
  }
  return { css: blocks.join(""), applied, rejected };

}
