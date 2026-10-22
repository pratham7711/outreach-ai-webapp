import { db } from "@/lib/db";

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
 * is the creator's own private data is gated on one proof instead:
 *
 *  IDENTITY. The roster row's creatorUserId is this portal account. It is only
 *  ever written by the person it names:
 *   - the marketplace join, when the creator's own join creates the row
 *     (lib/marketplace/join.ts);
 *   - accepting an agency's per-creator invite link (lib/portal/campaignInvite.ts)
 *     or connect link (lib/portal/connectLinkClaim.ts) -- the token is the
 *     agency's own grant to that creator, handed over through the agency's
 *     channel;
 *   - a Connect made while signed in, where the account the platform just
 *     authenticated carries this portal handle
 *     (app/api/portal/connections/[platform]/callback).
 *
 * A stored connection whose handle equals the portal handle is NOT a proof, and
 * was one until 2026-10-23. It shows that the owner of that platform account
 * authorised it once, not that this portal account is that person: a creator
 * who connects through an agency's connect link never needs a portal account,
 * registration does not verify the email, and handles can be changed, so
 * whoever registered the handle first was handed the creator's stats, offers
 * and earnings and could revoke their grants. The live consent above is the
 * same evidence taken at the one moment it does belong to this login.
 *
 * An email is not a proof. A roster row's contactEmail is typed in by the
 * agency or imported from a sign-up sheet, and portal registration never
 * verifies the address it is given, so matching the two let anyone who knew a
 * creator's email and handle take over that creator's profile. It can come back
 * only as a VERIFIED address, once registration proves the account owns it.
 *
 * CampaignInvite itself carries a creatorId and no portal identity; who
 * accepted it is recorded on the roster row, not on the invite. When a
 * new proof is added, add it here — this is the only place that decides.
 */
export type LinkedCreator = { id: string; orgId: string };

/* `email` is accepted so a whole portal session can be passed in, and is not
   read: see "An email is not a proof" above. */
export type LinkSubject = { handle: string; email?: string | null; creatorUserId?: string | null };

/**
 * Every Creator row this portal user has proven they own, across all orgs.
 * The handle is not consulted: a row is the account's because it names the
 * account, whatever handle either of them carries.
 */
export async function findLinkedCreatorsForHandle(
  subject: LinkSubject,
): Promise<LinkedCreator[]> {
  if (!subject.creatorUserId) return [];
  return db.creator.findMany({
    where: { deletedAt: null, creatorUserId: subject.creatorUserId },
    select: { id: true, orgId: true },
  });
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
 * not. The portal's own offer routes are gated on the proof above; the message
 * that announces the offer has to be addressed by the same rule or it leaks
 * what the gate protects. The proof is read straight off the row, so the two
 * directions cannot disagree.
 */
export function findProvenCreatorUserForCreator(creator: {
  id: string;
  handle: string;
  creatorUserId: string | null;
}): Promise<{ id: string } | null> {
  return Promise.resolve(creator.creatorUserId ? { id: creator.creatorUserId } : null);
}
