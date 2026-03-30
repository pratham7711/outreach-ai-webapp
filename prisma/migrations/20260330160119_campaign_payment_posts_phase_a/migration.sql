-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('MANAGED', 'SELF_MANAGED');

-- CreateEnum
CREATE TYPE "PaymentRelease" AS ENUM ('MANUAL', 'ON_POST_APPROVAL', 'ON_CREATOR_REQUEST');

-- CreateEnum
CREATE TYPE "PostApprovalMode" AS ENUM ('MANUAL', 'AUTO_APPROVED');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'HELD', 'PARTIALLY_RELEASED', 'FULLY_RELEASED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('REEL', 'STORY', 'POST', 'SHORT', 'VIDEO');

-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('RAZORPAY', 'STRIPE');

-- CreateEnum
CREATE TYPE "DepositPaymentMethod" AS ENUM ('CARD', 'UPI', 'NEFT', 'IMPS', 'RTGS', 'ENACH', 'WIRE');

-- CreateEnum
CREATE TYPE "InviteChannel" AS ENUM ('INSTAGRAM_DM', 'LINK');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NegotiationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'COUNTERED');

-- CreateEnum
CREATE TYPE "PayoutRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'UPI';
ALTER TYPE "PaymentMethod" ADD VALUE 'NEFT';
ALTER TYPE "PaymentMethod" ADD VALUE 'IMPS';
ALTER TYPE "PaymentMethod" ADD VALUE 'RTGS';
ALTER TYPE "PaymentMethod" ADD VALUE 'ENACH';
ALTER TYPE "PaymentMethod" ADD VALUE 'WIRE';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "depositStatus" "DepositStatus",
ADD COLUMN     "paymentMode" "PaymentMode" NOT NULL DEFAULT 'SELF_MANAGED',
ADD COLUMN     "paymentRelease" "PaymentRelease" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "postApprovalMode" "PostApprovalMode" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "activationId" TEXT,
ADD COLUMN     "mediaType" "MediaType",
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "status" "PostStatus" NOT NULL DEFAULT 'PENDING_REVIEW';

-- CreateTable
CREATE TABLE "CampaignDeposit" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "amountRequested" DOUBLE PRECISION NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "gateway" "PaymentGateway" NOT NULL,
    "method" "DepositPaymentMethod",
    "gatewayOrderId" TEXT,
    "gatewayPaymentId" TEXT,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "releasedAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutRequest" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "requestedAmount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PayoutRequestStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NegotiationOffer" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "offeredRate" DOUBLE PRECISION NOT NULL,
    "counterRate" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "NegotiationStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NegotiationOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignInvite" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "channel" "InviteChannel" NOT NULL DEFAULT 'LINK',
    "inviteToken" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignDeposit_campaignId_key" ON "CampaignDeposit"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignInvite_inviteToken_key" ON "CampaignInvite"("inviteToken");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_activationId_fkey" FOREIGN KEY ("activationId") REFERENCES "Activation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignDeposit" ADD CONSTRAINT "CampaignDeposit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignDeposit" ADD CONSTRAINT "CampaignDeposit_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutRequest" ADD CONSTRAINT "PayoutRequest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NegotiationOffer" ADD CONSTRAINT "NegotiationOffer_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignInvite" ADD CONSTRAINT "CampaignInvite_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
