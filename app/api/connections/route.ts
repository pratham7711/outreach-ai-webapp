import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const PLATFORMS = [
  { platform: "TIKTOK", name: "TikTok", description: "Import creator profiles and analytics.", icon: "🎵", category: "social" },
  { platform: "INSTAGRAM", name: "Instagram", description: "Sync creator data and engagement metrics.", icon: "📸", category: "social" },
  { platform: "YOUTUBE", name: "YouTube", description: "Connect channels and track video performance.", icon: "▶️", category: "social" },
  { platform: "TWITTER", name: "Twitter/X", description: "Monitor tweets and audience analytics.", icon: "🐦", category: "social" },
  { platform: "SPOTIFY", name: "Spotify", description: "Track music streams and artist analytics.", icon: "🎧", category: "social" },
  { platform: "PAYPAL", name: "PayPal", description: "Process creator payouts via PayPal.", icon: "💳", category: "payment" },
  { platform: "STRIPE", name: "Stripe", description: "Accept deposits and manage payments.", icon: "💸", category: "payment" },
  { platform: "RAZORPAY", name: "Razorpay", description: "Indian payment processing for payouts.", icon: "🏦", category: "payment" },
];

export { PLATFORMS };

const ConnectSchema = z.object({
  platform: z.string().min(1),
  accountName: z.string().max(200).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { uiConfig: true } });
  const uiConfig = (org?.uiConfig as any) ?? {};
  const connections: Record<string, any> = uiConfig.platformConnections ?? {};

  const result = PLATFORMS.map(p => ({
    ...p,
    connected: connections[p.platform]?.connected ?? false,
    connectedAt: connections[p.platform]?.connectedAt ?? null,
    accountName: connections[p.platform]?.accountName ?? null,
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;

  const body = await req.json();
  const parsed = ConnectSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { uiConfig: true } });
  const uiConfig = (org?.uiConfig as any) ?? {};
  const connections = uiConfig.platformConnections ?? {};

  connections[parsed.data.platform] = {
    connected: true,
    connectedAt: new Date().toISOString(),
    accountName: parsed.data.accountName ?? null,
  };

  await db.organization.update({
    where: { id: orgId },
    data: { uiConfig: { ...uiConfig, platformConnections: connections } },
  });

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;

  const platform = req.nextUrl.searchParams.get("platform");
  if (!platform) return NextResponse.json({ error: "platform required" }, { status: 400 });

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { uiConfig: true } });
  const uiConfig = (org?.uiConfig as any) ?? {};
  const connections = uiConfig.platformConnections ?? {};

  delete connections[platform];

  await db.organization.update({
    where: { id: orgId },
    data: { uiConfig: { ...uiConfig, platformConnections: connections } },
  });

  return NextResponse.json({ success: true });
}
