import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

// POST /api/ai/briefing
// Body: { type: "campaign" | "org", id?: string }
export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = auth;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const { type, id } = body as { type?: string; id?: string };

  if (type !== "campaign" && type !== "org") {
    return NextResponse.json({ error: "type must be 'org' or 'campaign'" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ── org briefing ──
  if (type === "org") {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totalCampaigns, activeCampaigns, payoutAgg, topPosts] = await Promise.all([
      db.campaign.count({ where: { orgId, createdAt: { gte: thirtyDaysAgo }, deletedAt: null } }),
      db.campaign.count({ where: { orgId, status: "IN_PROGRESS", deletedAt: null } }),
      db.payout.aggregate({
        where: { orgId, initiatedAt: { gte: thirtyDaysAgo } },
        _sum: { amount: true },
      }),
      db.post.findMany({
        where: { campaign: { orgId } },
        orderBy: { viewsCount: "desc" },
        take: 3,
        include: { creator: { select: { name: true } } },
      }),
    ]);

    const totalPayouts = payoutAgg._sum.amount ?? 0;
    const topCreatorLines = topPosts
      .map((p, i) => `${i + 1}. ${p.creator.name} — ${p.viewsCount.toLocaleString()} views`)
      .join("\n");

    const prompt = `You are a concise marketing analyst. Write a 2-3 paragraph narrative summary for an influencer campaign organization based on these stats from the last 30 days:

- Total new campaigns: ${totalCampaigns}
- Currently active campaigns: ${activeCampaigns}
- Total payouts issued: $${totalPayouts.toFixed(2)}
- Top 3 creators by views:
${topCreatorLines || "  (no posts yet)"}

Be professional, highlight trends, and keep it under 200 words.`;

    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: prompt }],
    });

    const summary = message.content[0].type === "text" ? message.content[0].text : "";
    return NextResponse.json({ summary, generatedAt: new Date().toISOString() });
  }

  // ── campaign briefing ──
  if (!id) {
    return NextResponse.json({ error: "id is required for type 'campaign'" }, { status: 400 });
  }

  const campaign = await db.campaign.findFirst({
    where: { id, orgId, deletedAt: null },
    include: {
      _count: { select: { activations: true, posts: true } },
    },
  });

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const payoutAgg = await db.payout.aggregate({
    where: { campaignId: id, orgId },
    _sum: { amount: true },
  });

  const totalPayout = payoutAgg._sum.amount ?? 0;

  const prompt = `You are a concise marketing analyst. Write a 1-2 paragraph campaign briefing for the following influencer campaign:

- Name: ${campaign.title}
- Status: ${campaign.status}
- Type: ${campaign.campaignType ?? "N/A"}
- Budget: ${campaign.budget ? `$${campaign.budget} ${campaign.currency}` : "Not set"}
- Creators activated: ${campaign._count.activations}
- Posts submitted: ${campaign._count.posts}
- Total payouts: $${totalPayout.toFixed(2)}

Summarize the campaign's current state, progress, and any notable points. Keep it under 150 words.`;

  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const summary = message.content[0].type === "text" ? message.content[0].text : "";
  return NextResponse.json({ summary, generatedAt: new Date().toISOString() });
}
