-- SongSoundLink: a song's sound on a platform without its own Song column (YouTube).
-- Same statements as lib/songs/songSoundLinkDdl.ts, which production runs via
-- /api/admin/migrate-song-sound-links.
-- CreateTable
CREATE TABLE "SongSoundLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "soundId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SongSoundLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SongSoundLink_orgId_idx" ON "SongSoundLink"("orgId");

-- CreateIndex
CREATE INDEX "SongSoundLink_soundId_idx" ON "SongSoundLink"("soundId");

-- CreateIndex
CREATE UNIQUE INDEX "SongSoundLink_songId_platform_key" ON "SongSoundLink"("songId", "platform");

-- AddForeignKey
ALTER TABLE "SongSoundLink" ADD CONSTRAINT "SongSoundLink_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongSoundLink" ADD CONSTRAINT "SongSoundLink_soundId_fkey" FOREIGN KEY ("soundId") REFERENCES "TikTokSound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

