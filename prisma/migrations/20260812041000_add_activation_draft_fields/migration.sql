-- Draft-approval step: creator-submitted draft content held on the Activation
-- before it is approved and posted. All nullable/additive (safe).
ALTER TABLE "Activation" ADD COLUMN IF NOT EXISTS "draftUrl" TEXT;
ALTER TABLE "Activation" ADD COLUMN IF NOT EXISTS "draftCaption" TEXT;
ALTER TABLE "Activation" ADD COLUMN IF NOT EXISTS "draftMediaType" "MediaType";
ALTER TABLE "Activation" ADD COLUMN IF NOT EXISTS "draftSubmittedAt" TIMESTAMP(3);
