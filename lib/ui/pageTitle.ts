import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

/** "Campaigns" -> "Campaigns · Made Boring Campaigns" in the browser tab. */
export const PAGE_TITLE_TEMPLATE = `%s · ${BRAND.name}`;

/**
 * The title for a dashboard section's layout.tsx.
 *
 * An object, not the bare string: in Next's metadata merge a string title
 * resolves the parent's template and then hands its children NO template, so a
 * page under the section that names itself ("Integrations" under Settings)
 * would lose the product suffix. Carrying the template forward keeps every
 * level reading "<name> · Made Boring Campaigns".
 */
export function sectionTitle(name: string): Metadata["title"] {
  return { default: name, template: PAGE_TITLE_TEMPLATE };
}
