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
 *
 * The wording that replaced those promises went too far the other way: "Note
 * that your team uses TikTok" asserts a fact nothing here establishes. Every
 * card said it, for all eleven platforms, on a page whose own header read "0
 * connected" -- so the catalogue told a brand-new org it used eleven services
 * it had never touched, and contradicted the count beside it. The description
 * now states the mechanism, which is true whether or not the row is marked.
 */
const PLATFORMS = [
  { platform: "TIKTOK", name: "TikTok", description: "Recorded for your reference only. No TikTok data is imported from here.", icon: "🎵", category: "social" },
  { platform: "INSTAGRAM", name: "Instagram", description: "Recorded for your reference only. No Instagram data is synced from here.", icon: "📸", category: "social" },
  { platform: "YOUTUBE", name: "YouTube", description: "Recorded for your reference only. No YouTube channel is connected from here.", icon: "▶️", category: "social" },
  { platform: "TWITTER", name: "Twitter/X", description: "Recorded for your reference only. No Twitter/X data is monitored from here.", icon: "🐦", category: "social" },
  { platform: "SPOTIFY", name: "Spotify", description: "Recorded for your reference only. No Spotify streams are tracked from here.", icon: "🎧", category: "social" },
  // Messaging channels
  { platform: "WHATSAPP", name: "WhatsApp", description: "Recorded for your reference only. No WhatsApp messages are sent from here.", icon: "💬", category: "messaging" },
  { platform: "TELEGRAM", name: "Telegram", description: "Recorded for your reference only. No Telegram bot is connected from here.", icon: "✈️", category: "messaging" },
  { platform: "DISCORD", name: "Discord", description: "Recorded for your reference only. No Discord bot is connected from here.", icon: "🎮", category: "messaging" },
  // Payment gateways
  { platform: "PAYPAL", name: "PayPal", description: "Recorded for your reference only. No PayPal payouts are processed from here.", icon: "💳", category: "payment" },
  { platform: "STRIPE", name: "Stripe", description: "Recorded for your reference only. No Stripe payments are processed from here.", icon: "💸", category: "payment" },
  { platform: "RAZORPAY", name: "Razorpay", description: "Recorded for your reference only. No Razorpay payouts are processed from here.", icon: "🏦", category: "payment" },
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
