import { db } from "@/lib/db";
import { stripAt } from "@/lib/format";

/**
 * Which org-side Creator rows a portal CreatorUser has PROVEN they own.
 *
 * The portal bridges its own auth to the agency-side roster by handle alone
 * (lib/portal/creatorLookup.ts), and registration checks uniqueness only
 * against CreatorUser — never against Creator. So signing up as "bigcreator"
 * matched every Creator row called "bigcreator" in every org on the platform,
 * and the portal then handed the new account that creator's connected
 * accounts, platform insights, brand reviews, negotiation offers and earnings,
 * and let it revoke their OAuth grants.
 *
 * Blocking the registration is not available: agencies add a creator to their
 * roster first and expect that person to sign up later with the same handle and
 * find their campaigns waiting. So the handle match survives for what it is
 * good for — showing a creator the campaigns they are on — and everything that
 * is the creator's own private data is gated on one of these proofs instead:
 *
 *  1. EMAIL. The roster row's contactEmail is the portal account's email,
 *     compared case-insensitively and trimmed. This is how an agency-created
 *     row gets linked, and it is how a row created by the marketplace join
 *     itself is linked (lib/marketplace/join.ts writes contactEmail from the
 *     CreatorUser profile).
 *  2. OAUTH. The roster row carries a CreatorSocialAccount whose handle — the
 *     one the PLATFORM returned at connect time (lib/platforms/accountSync.ts),
 *     never the portal username — is this portal handle. Connecting somebody
 *     else's account proves nothing, because the handle stored is the handle of
 *     the account that actually authorised.
 *
 * There is no third signal available: CampaignInvite carries a creatorId and no
 * portal identity, so an invite cannot say WHO accepted it, and the schema is
 * frozen for this change. When one is added, add it here — this is the only
 * place that decides.
 */
export type LinkedCreator = { id: string; orgId: string };

export type LinkSubject = { handle: string; email: string };

function handleVariants(handle: string): string[] {
  const bare = stripAt(handle);
  return [bare, `@${bare}`];
}

function norm(value: string | null | undefined): string {
  return stripAt(value ?? "").trim().toLowerCase();
}

/** Every Creator row this portal user has proven they own, across all orgs. */
export async function findLinkedCreatorsForHandle(
  subject: LinkSubject,
): Promise<LinkedCreator[]> {
  const bareHandle = norm(subject.handle);
  if (!bareHandle) return [];

  const candidates = await db.creator.findMany({
    where: {
      deletedAt: null,
      OR: handleVariants(subject.handle).map((handle) => ({ handle })),
    },
    select: { id: true, orgId: true, contactEmail: true },
  });
  if (candidates.length === 0) return [];

  const email = (subject.email ?? "").trim().toLowerCase();
  const proven = new Set(
    email
      ? candidates
          .filter((c) => (c.contactEmail ?? "").trim().toLowerCase() === email)
          .map((c) => c.id)
      : [],
  );

  const unproven = candidates.filter((c) => !proven.has(c.id));
  if (unproven.length > 0) {
    const accounts = await db.creatorSocialAccount.findMany({
      where: { creatorId: { in: unproven.map((c) => c.id) } },
      select: { creatorId: true, handle: true },
    });
    for (const account of accounts) {
      if (norm(account.handle) === bareHandle) proven.add(account.creatorId);
    }
  }

  return candidates
    .filter((c) => proven.has(c.id))
    .map((c) => ({ id: c.id, orgId: c.orgId }));
}

/** The same answer for one row, e.g. the creator named on a negotiation offer. */
export async function isCreatorLinked(
  creatorId: string,
  subject: LinkSubject,
): Promise<boolean> {
  const linked = await findLinkedCreatorsForHandle(subject);
  return linked.some((c) => c.id === creatorId);
}
