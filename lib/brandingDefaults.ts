export const PLATFORM_DEFAULT_BRANDING = {
  primaryColor: "#4F46E5",
  secondaryColor: "#1E1B4B",
  accentColor: "#F59E0B",
  fontFamily: "Inter",
} as const;

export type BrandingField = keyof typeof PLATFORM_DEFAULT_BRANDING;

export function customBrandingValue(
  field: BrandingField,
  value: string | null | undefined
): string | null {
  if (!value) return null;
  return value === PLATFORM_DEFAULT_BRANDING[field] ? null : value;
}

/**
 * The org's favicon, or null when there is nothing usable to point a <link> at.
 *
 * Returning null rather than "" matters: an empty href resolves to the current
 * page, so the browser would request the HTML document as an icon. Null leaves
 * Next's file conventions (app/icon.png, app/favicon.ico) in charge instead.
 *
 * Values are validated on write by /api/org, but this column predates that
 * check and is read forever, so the parse happens here too. A site-relative
 * path is accepted; anything that is not http(s) — javascript:, data:, a bare
 * hostname — is not.
 */
export function usableIconHref(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.startsWith("//")) return null;
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
