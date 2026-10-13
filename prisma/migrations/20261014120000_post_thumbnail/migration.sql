CREATE TABLE IF NOT EXISTS "PostThumbnail" (
    "postId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "data" BYTEA,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failure" TEXT,
    CONSTRAINT "PostThumbnail_pkey" PRIMARY KEY ("postId")
  );

CREATE INDEX IF NOT EXISTS "PostThumbnail_orgId_idx" ON "PostThumbnail"("orgId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostThumbnail_postId_fkey') THEN
      ALTER TABLE "PostThumbnail" ADD CONSTRAINT "PostThumbnail_postId_fkey"
        FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
