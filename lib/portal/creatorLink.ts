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
 *  1. IDENTITY. The roster row's creatorUserId is this portal account. The
 *     marketplace join writes it when the creator's own join creates the row
 *     (lib/marketplace/join.ts), and accepting an agency's per-creator invite
 *     link writes it on the invited row (lib/portal/campaignInvite.ts) -- the
 *     token is the agency's own grant to that creator, handed over through the
 *     agency's channel. Either way it is only ever set by the person it names.
 *  2. OAUTH. The roster row carries a CreatorSocialAccount whose handle — the
 *     one the PLATFORM returned at connect time (lib/platforms/accountSync.ts),
 *     never the portal username — is this portal handle. Connecting somebody
 *     else's account proves nothing, because the handle stored is the handle of
 *     the account that actually authorised.
 *
 * An email is not a proof. A roster row's contactEmail is typed in by the
 * agency or imported from a sign-up sheet, and portal registration never
 * verifies the address it is given, so matching the two let anyone who knew a
 * creator's email and handle take over that creator's profile. It can come back
 * only as a VERIFIED address, once registration proves the account owns it.
 *
 * CampaignInvite itself carries a creatorId and no portal identity; who
 * accepted it is recorded on the roster row (proof 1), not on the invite. When a
 * new proof is added, add it here — this is the only place that decides.
 */
export type LinkedCreator = { id: string; orgId: string };

export type LinkSubject = { handle: string; email: string; creatorUserId?: string | null };

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
    select: { id: true, orgId: true, creatorUserId: true },
  });
  if (candidates.length === 0) return [];

  const self = subject.creatorUserId ?? null;
  const proven = new Set(self ? candidates.filter((c) => c.creatorUserId === self).map((c) => c.id) : []);

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
