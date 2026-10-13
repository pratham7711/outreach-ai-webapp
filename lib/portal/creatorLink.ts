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

/* `email` is accepted so a whole portal session can be passed in, and is not
   read: see "An email is not a proof" above. */
export type LinkSubject = { handle: string; email?: string | null; creatorUserId?: string | null };

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

  /* A row that names this portal account is a candidate whatever its handle:
     an invite or a connect link links the row without touching the handle the
     agency typed, and proof 1 does not depend on it. */
  const candidates = await db.creator.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...handleVariants(subject.handle).map((handle) => ({ handle })),
        ...(subject.creatorUserId ? [{ creatorUserId: subject.creatorUserId }] : []),
      ],
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

/**
 * The other direction: which portal account, if any, has proven it owns this
 * org-side roster row -- for the agency side deciding who to address.
 *
 * negotiations/start-batch used to pick the portal account by handle alone and
 * open the offer's conversation with it, so the rate, the campaign and the
 * agency's name went to whoever had registered that handle first, proof or
 * not. The portal's own offer routes are gated on the proofs above; the message
 * that announces the offer has to be addressed by the same rule or it leaks
 * what the gate protects.
 *
 * Proof 1 is read straight off the row. Proof 2 starts from the portal account
 * holding the roster handle and asks the same question findLinkedCreatorsForHandle
 * answers, so the two directions cannot disagree.
 */
export async function findProvenCreatorUserForCreator(creator: {
  id: string;
  handle: string;
  creatorUserId: string | null;
}): Promise<{ id: string } | null> {
  if (creator.creatorUserId) return { id: creator.creatorUserId };
  const candidate = await db.creatorUser.findFirst({
    where: { handle: { in: handleVariants(creator.handle) } },
    select: { id: true, handle: true },
  });
  if (!candidate) return null;
  const proven = await isCreatorLinked(creator.id, {
    handle: candidate.handle,
    creatorUserId: candidate.id,
  });
  return proven ? { id: candidate.id } : null;
}
