-- Generated from lib/posts/removedSchemaDdl.ts; idempotent.
ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3);

ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "removedById" TEXT;

CREATE INDEX IF NOT EXISTS "Post_campaignId_removedAt_idx" ON "Post"("campaignId", "removedAt");
