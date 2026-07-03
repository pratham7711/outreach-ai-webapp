import { customAlphabet } from "nanoid";
import { db } from "@/lib/db";

// URL-safe suffix for public slugs (lowercase + digits, no ambiguous chars).
const slugSuffix = customAlphabet("23456789abcdefghjkmnpqrstuvwxyz", 6);
// Human-typable invite codes (uppercase + digits, no 0/O/1/I to avoid confusion).
const inviteAlphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);

/** Convert a campaign title into a url-safe base slug. */
export function slugifyTitle(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Generate a unique public slug for a campaign: `<slugified-title>-<nanoid>`.
 * The nanoid suffix guarantees uniqueness; we retry on the (extremely unlikely)
 * collision. Never accept a client-supplied slug.
 */
export async function generatePublicSlug(title: string): Promise<string> {
  const base = slugifyTitle(title) || "campaign";
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${base}-${slugSuffix()}`;
    const existing = await db.campaign.findUnique({
      where: { publicSlug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  // Fallback: timestamp-salted, still slug-safe.
  return `${base}-${slugSuffix()}${Date.now().toString(36)}`;
}

/** Generate a fresh INVITE_ONLY join code. Server-side only. */
export function generateInviteCode(): string {
  return inviteAlphabet();
}
