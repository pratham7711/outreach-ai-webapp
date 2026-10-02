-- Generated from lib/ops/trackerIndexDdl.ts; idempotent.
CREATE INDEX IF NOT EXISTS "SoundTrackerSnapshot_soundId_recordedAt_idx" ON "SoundTrackerSnapshot"("soundId", "recordedAt");

CREATE INDEX IF NOT EXISTS "CreatorTrackerSnapshot_recordedAt_idx" ON "CreatorTrackerSnapshot"("recordedAt");

CREATE INDEX IF NOT EXISTS "TikTokSound_orgId_idx" ON "TikTokSound"("orgId");
