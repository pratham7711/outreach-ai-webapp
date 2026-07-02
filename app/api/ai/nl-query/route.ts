import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

type Intent =
  | { type: "list_campaigns"; status?: string; limit?: number }
  | { type: "list_creators"; platform?: string; limit?: number }
  | { type: "get_org_kpis" }
  | { type: "search_creators"; query: string }
  | { type: "list_payouts"; status?: string; limit?: number }
  | { type: "unknown" };

const CLASSIFY_SYSTEM = `You are a query intent classifier for an influencer marketing platform.
Given a natural language query, return ONLY a JSON object matching one of these intent types. No prose.

Valid intents:
- { "type": "list_campaigns", "status"?: "IN_PROGRESS"|"PENDING"|"COMPLETE"|"CANCELLED", "limit"?: number }
- { "type": "list_creators", "platform"?: "TIKTOK"|"INSTAGRAM"|"YOUTUBE", "limit"?: number }
- { "type": "get_org_kpis" }
- { "type": "search_creators", "query": string }
- { "type": "list_payouts", "status"?: "PENDING"|"SUCCESS"|"FAILED", "limit"?: number }
- { "type": "unknown" }

Examples:
"show active campaigns" → {"type":"list_campaigns","status":"IN_PROGRESS"}
"list tiktok creators" → {"type":"list_creators","platform":"TIKTOK"}
"what are my KPIs?" → {"type":"get_org_kpis"}
"find creators about music" → {"type":"search_creators","query":"music"}
"show pending payouts" → {"type":"list_payouts","status":"PENDING"}
"what is the capital of France?" → {"type":"unknown"}`;

// POST /api/ai/nl-query
// Body: { query: string }
export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = auth;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "AI not configured" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const query = typeof body.query === "string" ? body.query.trim() : "";

  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Classify intent
  const classifyRes = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    system: CLASSIFY_SYSTEM,
    messages: [{ role: "user", content: query }],
  });

  let intent: Intent = { type: "unknown" };
  try {
    const first = classifyRes.content[0];
    const raw = first?.type === "text" ? first.text : "{}";
    intent = JSON.parse(raw) as Intent;
  } catch {
    intent = { type: "unknown" };
  }

  const clampLimit = (limit: unknown): number =>
    typeof limit === "number" && Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 10;

  // Execute typed Prisma query based on intent
  if (intent.type === "list_campaigns") {
    const { status, limit } = intent;
    const campaigns = await db.campaign.findMany({
      where: { orgId, deletedAt: null, ...(status && { status: status as any }) },
      orderBy: { createdAt: "desc" },
      take: clampLimit(limit),
      select: { id: true, title: true, status: true, budget: true, currency: true, createdAt: true },
    });
    return NextResponse.json({ intent, results: campaigns, count: campaigns.length });
  }

  if (intent.type === "list_creators") {
    const { platform, limit } = intent;
    const creators = await db.creator.findMany({
      where: { orgId, ...(platform && { platform: platform as any }) },
      orderBy: { followersCount: "desc" },
      take: clampLimit(limit),
      select: { id: true, name: true, handle: true, platform: true, followersCount: true },
    });
    return NextResponse.json({ intent, results: creators, count: creators.length });
  }

  if (intent.type === "search_creators") {
    const creators = await db.creator.findMany({
      where: {
        orgId,
        OR: [
          { name: { contains: intent.query, mode: "insensitive" } },
          { bio: { contains: intent.query, mode: "insensitive" } },
          { handle: { contains: intent.query, mode: "insensitive" } },
        ],
      },
      take: 20,
      select: { id: true, name: true, handle: true, platform: true, followersCount: true, bio: true },
    });
    return NextResponse.json({ intent, results: creators, count: creators.length });
  }

  if (intent.type === "list_payouts") {
    const { status, limit } = intent;
    const payouts = await db.payout.findMany({
      where: { orgId, ...(status && { status: status as any }) },
      orderBy: { createdAt: "desc" },
      take: clampLimit(limit),
      select: { id: true, amount: true, currency: true, status: true, createdAt: true },
    });
    return NextResponse.json({ intent, results: payouts, count: payouts.length });
  }

  if (intent.type === "get_org_kpis") {
    const [campaignCount, creatorCount, payoutAgg, pendingPayouts] = await Promise.all([
      db.campaign.count({ where: { orgId, deletedAt: null, status: "IN_PROGRESS" } }),
      db.creator.count({ where: { orgId } }),
      db.payout.aggregate({ where: { orgId }, _sum: { amount: true } }),
      db.payout.count({ where: { orgId, status: "PENDING" } }),
    ]);
    return NextResponse.json({
      intent,
      results: {
        activeCampaigns: campaignCount,
        totalCreators: creatorCount,
        totalPayoutsAmount: payoutAgg._sum.amount ?? 0,
        pendingPayouts,
      },
      count: 1,
    });
  }

  // unknown intent
  return NextResponse.json({
    intent,
    error: "I couldn't understand that query. Try: 'show active campaigns', 'list creators on TikTok', 'show pending payouts'",
  });
}
