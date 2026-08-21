-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Platform" ADD VALUE 'LINKEDIN';
ALTER TYPE "Platform" ADD VALUE 'SNAPCHAT';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "songId" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "phaseId" TEXT;

-- CreateTable
CREATE TABLE "Song" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "isrc" TEXT,
    "releaseDate" TIMESTAMP(3),
    "coverUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignPhase" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "targetPosts" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignPhase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Song_orgId_idx" ON "Song"("orgId");

-- CreateIndex
CREATE INDEX "Song_orgId_deletedAt_idx" ON "Song"("orgId", "deletedAt");

-- CreateIndex
CREATE INDEX "CampaignPhase_campaignId_idx" ON "CampaignPhase"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignPhase_campaignId_sequence_key" ON "CampaignPhase"("campaignId", "sequence");

-- CreateIndex
CREATE INDEX "Post_phaseId_idx" ON "Post"("phaseId");

-- AddForeignKey
ALTER TABLE "Song" ADD CONSTRAINT "Song_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignPhase" ADD CONSTRAINT "CampaignPhase_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "CampaignPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
