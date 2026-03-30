-- CreateEnum
CREATE TYPE "MarketplaceVisibility" AS ENUM ('ROSTER_ONLY', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CreatorNiche" AS ENUM ('MUSIC', 'FASHION', 'TECH', 'FITNESS', 'BEAUTY', 'FOOD', 'TRAVEL', 'GAMING', 'COMEDY', 'EDUCATION', 'LIFESTYLE', 'SPORTS');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "marketplaceVisibility" "MarketplaceVisibility" NOT NULL DEFAULT 'ROSTER_ONLY';

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "boostRate" DOUBLE PRECISION,
ADD COLUMN     "niches" "CreatorNiche"[];

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "bankAccountName" TEXT,
ADD COLUMN     "bankAccountNumber" TEXT,
ADD COLUMN     "bankIFSC" TEXT,
ADD COLUMN     "bankRoutingNumber" TEXT,
ADD COLUMN     "bankSwift" TEXT;

-- CreateTable
CREATE TABLE "CreatorUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "platform" "Platform" NOT NULL DEFAULT 'TIKTOK',
    "followersCount" INTEGER NOT NULL DEFAULT 0,
    "averageViews" INTEGER NOT NULL DEFAULT 0,
    "rate" DOUBLE PRECISION,
    "boostRate" DOUBLE PRECISION,
    "lifetimeEarnings" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cpm" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "averageRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "niches" "CreatorNiche"[],
    "bankAccountName" TEXT,
    "bankAccountNumber" TEXT,
    "bankIFSC" TEXT,
    "bankSwift" TEXT,
    "bankRoutingNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorSession" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignProposal" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "proposedRate" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorReview" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "tags" JSONB,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorTestimonial" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreatorTestimonial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorUser_email_key" ON "CreatorUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorUser_handle_key" ON "CreatorUser"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorSession_token_key" ON "CreatorSession"("token");

-- AddForeignKey
ALTER TABLE "CreatorSession" ADD CONSTRAINT "CreatorSession_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "CreatorUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProposal" ADD CONSTRAINT "CampaignProposal_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignProposal" ADD CONSTRAINT "CampaignProposal_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "CreatorUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorReview" ADD CONSTRAINT "CreatorReview_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorReview" ADD CONSTRAINT "CreatorReview_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorTestimonial" ADD CONSTRAINT "CreatorTestimonial_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "CreatorUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorTestimonial" ADD CONSTRAINT "CreatorTestimonial_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorTestimonial" ADD CONSTRAINT "CreatorTestimonial_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
