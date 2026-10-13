/**
 * The write that brings a dead-lettered post back.
 *
 * Five charged failures stamp `Post.syncDisabledAt` (lib/sync/postSweepRun),
 * and that column takes the post out of the sweep's own query
 * (lib/sync/sweepCandidates). Until this existed, the only thing that ever set
 * it back to null was the one-shot app/api/admin/repair-dead-letters route --
 * so a post could be read successfully on demand, or have tracking switched
 * back on by a person, and the screen would say "tracked" while the cron never
 * looked at it again.
 *
 * Two events now clear it, because each one is the dead-letter's premise being
 * refuted:
 *   - a measured read (applyPostMetrics' measured branch): the platform did
 *     answer for this post, so "the platform will never answer" is false;
 *   - tracking switched on (the single-post track route and the bulk "track"
 *     action): a person has asked for the post to be read, which is a new
 *     instruction, not a resumption of the old streak.
 *
 * Both columns go together. Clearing `syncDisabledAt` alone would leave the
 * counter at MAX_SYNC_FAILURES, so the very next charged miss would dead-letter
 * the post again without the four retries every other post gets. A post that
 * really is gone simply earns its way back to the dead letter on its own
 * merits -- a settled reason (post-deleted, post-hidden) still sends it there
 * in one read.
 */
export const DEAD_LETTER_CLEARED = { syncFailCount: 0, syncDisabledAt: null } as const;
