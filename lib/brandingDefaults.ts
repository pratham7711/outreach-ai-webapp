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
