import { db } from "@/lib/db";

/**
 * Removes a creator's login and everything that exists only because of it.
 *
 * Runs AFTER every connected account has been through Disconnect (the delete
 * route does that first), so no OAuth token is left for this to orphan.
 *
 * What goes, and what stays:
 *
 *  - The login itself, its sessions, and the rows that cannot outlive it
 *    because their creatorUserId is required: proposals, testimonials, and the
 *    portal's message threads (each Message hangs off a Conversation).
 *  - What the AGENCY owns stays, unlinked from the login: the roster row
 *    (Creator.creatorUserId set null -- the same thing ON DELETE SET NULL does
 *    in lib/platforms/identitySchemaDdl.ts), the campaign posts and activations
 *    on it, and payout requests, which are the agency's financial record.
 *  - Any CreatorSocialAccount still stamped with this login is deleted rather
 *    than unlinked: it holds the creator's token, and keeping a credential for
 *    someone who asked to be deleted is the one outcome this must not have.
 *
 * One transaction, so a failure part-way leaves the login whole and the
 * creator can simply press Delete again.
 */
export async function deleteCreatorLogin(creatorUserId: string): Promise<void> {
  const conversations = await db.conversation.findMany({
    where: { creatorUserId },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);

  await db.$transaction([
    ...(conversationIds.length > 0
      ? [
          /* NegotiationOffer.conversationId is a plain string, not a relation,
             so nothing stops it pointing at a thread that no longer exists. */
          db.negotiationOffer.updateMany({
            where: { conversationId: { in: conversationIds } },
            data: { conversationId: null },
          }),
          db.message.deleteMany({ where: { conversationId: { in: conversationIds } } }),
          db.conversation.deleteMany({ where: { id: { in: conversationIds } } }),
        ]
      : []),
    db.creatorTestimonial.deleteMany({ where: { creatorUserId } }),
    db.campaignProposal.deleteMany({ where: { creatorUserId } }),
    db.payoutRequest.updateMany({ where: { creatorUserId }, data: { creatorUserId: null } }),
    db.creatorSocialAccount.deleteMany({ where: { creatorUserId } }),
    db.creator.updateMany({ where: { creatorUserId }, data: { creatorUserId: null } }),
    db.creatorSession.deleteMany({ where: { creatorUserId } }),
    db.creatorUser.delete({ where: { id: creatorUserId } }),
  ]);
}
