export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME ?? "Made Boring Campaigns",
  /* The compact mark, for anywhere a full name will not fit. "MB", not
     "Campaigns": the umbrella logo is the only Made Boring asset we carry. */
  short: process.env.NEXT_PUBLIC_BRAND_SHORT ?? "MB",
  umbrella: "Made Boring",
  umbrellaUrl: "https://madeboring.com",
  legalEntity: process.env.NEXT_PUBLIC_LEGAL_ENTITY ?? "Made Boring",
  domain: "campaign.madeboring.com",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "https://campaign.madeboring.com",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "prathamsharma7711@gmail.com",
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL ?? "prathamsharma7711@gmail.com",
  jurisdiction: "India",
  updated: "13 August 2026",
} as const;

export const POWERED_BY = `Powered by ${BRAND.name}`;
