import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { AI_ASSISTANT_FEATURE } from "@/lib/featureKeys";
import { draftOutreach, validateOutreachGrounding } from "@/lib/ai/outreach/draftOutreach";

const schema = z.object({
  creatorIds: z.array(z.string().min(1)).min(1).max(10),
});

// POST /api/campaigns/[id]/outreach/draft
// Generates personalised invite copy for the selected creators, grounded ONLY in
// the campaign brief and each creator's own stats. It NEVER sends: the response is
// draft copy for an operator to review and send through the existing invite flow.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = auth;
  const { id } = await params;

  const entitlements = await getOrgEntitlements(orgId);
  if (!hasOrgFeature(entitlements, AI_ASSISTANT_FEATURE)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const campaign = await db.campaign.findFirst({
    where: { id, orgId, deletedAt: null },
    select: { id: true, title: true, guidelines: true, requirements: true },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const brief = [campaign.guidelines, campaign.requirements]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n\n") || `Invitation to join the campaign "${campaign.title}".`;

  const creators = await db.creator.findMany({
    where: { id: { in: parsed.data.creatorIds }, orgId, deletedAt: null },
    select: {
      id: true,
      name: true,
      handle: true,
      platform: true,
      followersCount: true,
      niches: true,
    },
  });
  if (creators.length === 0) {
    return NextResponse.json({ error: "No matching creators" }, { status: 404 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const drafts = await Promise.all(
    creators.map(async (c) => {
      const evidence: { label: string; value: string | number }[] = [
        { label: "Platform", value: String(c.platform) },
        { label: "Followers", value: Math.round(c.followersCount) },
      ];
      if (c.niches.length > 0) {
        evidence.push({ label: "Niches", value: c.niches.join(", ") });
      }
      const input = { handle: c.handle, name: c.name, brief, evidence };
      try {
        const { subject, body, groundedFacts } = await draftOutreach({ input, client });
        const grounding = validateOutreachGrounding(`${subject}\n${body}`, input);
        return { creatorId: c.id, handle: c.handle, name: c.name, subject, body, groundedFacts, grounding, error: null };
      } catch (err) {
        return {
          creatorId: c.id,
          handle: c.handle,
          name: c.name,
          subject: null,
          body: null,
          groundedFacts: [],
          grounding: null,
          error: err instanceof Error ? err.message : "draft failed",
        };
      }
    }),
  );

  // Draft only. No CampaignInvite is created and nothing is delivered here; sending
  // stays an explicit, separate, operator-approved action.
  return NextResponse.json({ campaignId: campaign.id, drafts, sent: false });
}
