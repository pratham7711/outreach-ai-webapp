import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

/**
 * These are a record, not an integration.
 *
 * Marking a platform "connected" writes {connected, accountName} into
 * uiConfig and nothing else: there is no OAuth, no token, no verification and
 * no call to any of these services. The descriptions used to promise otherwise
 * — "Process creator payouts via PayPal", "Send campaign updates via WhatsApp
 * Business" — which meant a user could click Connect on a payment provider and
 * reasonably believe payouts would now process. That is the most consequential
 * false claim in the product, so the copy now says what the button does.
 *
 * When a real integration lands, its description changes with it.
 */
const PLATFORMS = [
  { platform: "TIKTOK", name: "TikTok", description: "Note that your team uses TikTok. No data is imported yet.", icon: "🎵", category: "social" },
  { platform: "INSTAGRAM", name: "Instagram", description: "Note that your team uses Instagram. No data is synced yet.", icon: "📸", category: "social" },
  { platform: "YOUTUBE", name: "YouTube", description: "Note that your team uses YouTube. No channels are connected yet.", icon: "▶️", category: "social" },
  { platform: "TWITTER", name: "Twitter/X", description: "Note that your team uses Twitter/X. No data is monitored yet.", icon: "🐦", category: "social" },
  { platform: "SPOTIFY", name: "Spotify", description: "Note that your team uses Spotify. No streams are tracked yet.", icon: "🎧", category: "social" },
  // Messaging channels
  { platform: "WHATSAPP", name: "WhatsApp", description: "Note that your team uses WhatsApp. No messages are sent from here yet.", icon: "💬", category: "messaging" },
  { platform: "TELEGRAM", name: "Telegram", description: "Note that your team uses Telegram. No bot is connected yet.", icon: "✈️", category: "messaging" },
  { platform: "DISCORD", name: "Discord", description: "Note that your team uses Discord. No bot is connected yet.", icon: "🎮", category: "messaging" },
  // Payment gateways
  { platform: "PAYPAL", name: "PayPal", description: "Note that your team uses PayPal. Payouts are not processed from here.", icon: "💳", category: "payment" },
  { platform: "STRIPE", name: "Stripe", description: "Note that your team uses Stripe. Payments are not processed from here.", icon: "💸", category: "payment" },
  { platform: "RAZORPAY", name: "Razorpay", description: "Note that your team uses Razorpay. Payouts are not processed from here.", icon: "🏦", category: "payment" },
];

export { PLATFORMS };

const ConnectSchema = z.object({
  platform: z.string().min(1),
  accountName: z.string().max(200).optional(),
});

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = auth;

  const org = await db.organization.findUnique({ where: { id: orgId }, select: { uiConfig: true } });
  const uiConfig = (org?.uiConfig as any) ?? {};
  const connections: Record<string, any> = uiConfig.platformConnections ?? {};

  const platforms = PLATFORMS.map(p => ({
    ...p,
    connected: connections[p.platform]?.connected ?? false,
    connectedAt: connections[p.platform]?.connectedAt ?? null,
    accountName: connections[p.platform]?.accountName ?? null,
  }));

  return NextResponse.json(platforms);
}

export async function POST(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = auth;

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
  const auth = await authenticateRequest(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = auth;

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
