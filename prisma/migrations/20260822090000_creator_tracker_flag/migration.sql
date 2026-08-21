-- Creator watchlist for the Trackers page's Creators sub-tab.
-- Generated from lib/creatorcore/parityDdl.ts — keep the two in sync.
-- Idempotent so it is safe to apply to an environment that already ran it via
-- the /api/admin/cc-sync route.

ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "trackedSince" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Creator_orgId_trackedSince_idx" ON "Creator"("orgId", "trackedSince");
