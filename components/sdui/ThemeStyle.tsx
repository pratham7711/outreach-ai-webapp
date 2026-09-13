/**
 * Emits the server-resolved theme as a real stylesheet.
 *
 * This REPLACES an inline style object on the dashboard root. The difference is
 * not cosmetic: an inline custom property beats every selector, so the previous
 * approach put a tenant's brand colour above `.dark` and `.creatorcore` in the
 * cascade and it bled into every mode. A <style> block carrying `:root.<mode>`
 * sits at the same specificity as the stylesheet's own theme blocks, so modes
 * resolve normally and a tenant can drive twenty tokens as safely as one.
 *
 * dangerouslySetInnerHTML is the only way to write a stylesheet body, and it is
 * safe HERE and only here because the string never contains input: emit.ts
 * writes contract keys and re-serialised values exclusively.
 */
import { resolveOrgTheme } from "@/lib/sdui/theme/resolve";

export async function ThemeStyle({
  orgId,
  primaryColor,
  uiConfig,
}: {
  orgId: string | null | undefined;
  /** White-label's existing brand colour, folded in as the highest layer so its
   *  behaviour is unchanged and only its position in the cascade moves. */
  primaryColor?: string | null;
  /** The layout already holds the org's uiConfig. Passing it keeps this from
   *  re-reading the same row on every dashboard render. */
  uiConfig?: Record<string, unknown> | null;
}) {
  const theme = await resolveOrgTheme(orgId, primaryColor ?? undefined, uiConfig);
  if (!theme.css) return null;
  return (
    <style
      id="sdui-theme"
      data-sdui-theme-version={theme.version}
      data-sdui-degraded={theme.degraded ? "true" : undefined}
      dangerouslySetInnerHTML={{ __html: theme.css }}
    />
  );
}
