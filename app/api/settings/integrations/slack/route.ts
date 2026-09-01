import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { createAuditActor, logAudit } from "@/lib/audit";
import type { Prisma } from "@/lib/generated/prisma";
import {
  NOTIFICATION_EVENTS,
  isSlackWebhookUrl,
  postToSlack,
  readSlackIntegration,
  type SlackIntegration,
} from "@/lib/notifications";

/**
 * Org-level Slack integration — the reference's Settings → Integrations card
 * ("Connect with Slack to receive updates and notifications directly in your
 * selected channels").
 *
 * Deliberately an incoming WEBHOOK, not Slack OAuth: OAuth needs a registered
 * Slack app plus a client secret in every environment, and buys nothing here —
 * an incoming webhook is already channel-bound, revocable from Slack's side,
 * and takes a workspace admin one minute to mint. The stored `channel` is a
 * display label only; the webhook itself decides where messages land.
 *
 * Stored in Organization.uiConfig (the documented home for org settings —
 * needs no migration, which matters because prod has no _prisma_migrations).
 *
 * The webhook URL is write-only: GET returns a masked form. It is a
 * capability, and anyone who can read it can post to the channel.
 */

const PutSchema = z.object({
  webhookUrl: z
    .string()
    .trim()
    .max(500)
    .refine(isSlackWebhookUrl, "Must be a Slack incoming-webhook URL (https://hooks.slack.com/services/…)")
    .optional(),
  channel: z.string().trim().max(80).optional(),
  events: z.record(z.string(), z.boolean()).optional(),
});

const KNOWN_KEYS = new Set(NOTIFICATION_EVENTS.map((e) => e.key));

async function requireSettingsAdmin() {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const role = (session.user as any).role as string;
  if (!hasPermission(role, "settings:*")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { orgId: (session.user as any).orgId as string, session };
}

function mask(url: string): string {
  // hooks.slack.com/services/T0123…/…  — enough to recognize, useless to replay.
  return url.length > 40 ? `${url.slice(0, 40)}…` : url;
}

function view(slack: SlackIntegration | null) {
  const events: Record<string, boolean> = {};
  for (const def of NOTIFICATION_EVENTS) {
    const override = slack?.events?.[def.key];
    events[def.key] = typeof override === "boolean" ? override : def.defaultOn;
  }
  return {
    connected: Boolean(slack?.webhookUrl),
    webhookMask: slack?.webhookUrl ? mask(slack.webhookUrl) : null,
    channel: slack?.channel ?? null,
    connectedAt: slack?.connectedAt ?? null,
    events,
    catalog: NOTIFICATION_EVENTS,
  };
}

async function loadUiConfig(orgId: string) {
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { uiConfig: true },
  });
  return org
    ? ((org.uiConfig as Record<string, unknown> | null) ?? {})
    : null;
}

async function saveSlack(orgId: string, uiConfig: Record<string, unknown>, slack: SlackIntegration | null) {
  const integrations = {
    ...(uiConfig.integrations && typeof uiConfig.integrations === "object" ? (uiConfig.integrations as Record<string, unknown>) : {}),
  };
  if (slack) integrations.slack = slack;
  else delete integrations.slack;
  await db.organization.update({
    where: { id: orgId },
    data: { uiConfig: { ...uiConfig, integrations } as Prisma.InputJsonValue },
  });
}

export async function GET() {
  const auth_ = await requireSettingsAdmin();
  if ("error" in auth_) return auth_.error;
  const uiConfig = await loadUiConfig(auth_.orgId);
  if (!uiConfig) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view(readSlackIntegration(uiConfig)));
}

export async function PUT(request: NextRequest) {
  const auth_ = await requireSettingsAdmin();
  if ("error" in auth_) return auth_.error;
  const { orgId, session } = auth_;

  const parsed = PutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const uiConfig = await loadUiConfig(orgId);
  if (!uiConfig) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const current = readSlackIntegration(uiConfig);
  if (!current?.webhookUrl && !parsed.data.webhookUrl) {
    return NextResponse.json({ error: "A webhook URL is required to connect Slack" }, { status: 400 });
  }

  const eventUpdates = Object.fromEntries(
    Object.entries(parsed.data.events ?? {}).filter(([key]) => KNOWN_KEYS.has(key))
  );

  const next: SlackIntegration = {
    webhookUrl: parsed.data.webhookUrl ?? current?.webhookUrl,
    channel: parsed.data.channel !== undefined ? parsed.data.channel : current?.channel,
    connectedAt: current?.connectedAt ?? new Date().toISOString(),
    events: { ...(current?.events ?? {}), ...eventUpdates },
  };

  await saveSlack(orgId, uiConfig, next);

  await logAudit({
    orgId,
    ...createAuditActor(session),
    action: "org.update",
    entityType: "organization",
    entityId: orgId,
    entityLabel: "Slack integration",
    metadata: { integration: "slack", connected: true },
  });

  return NextResponse.json(view(next));
}

/** Sends a test message through the stored webhook. */
export async function POST() {
  const auth_ = await requireSettingsAdmin();
  if ("error" in auth_) return auth_.error;

  const uiConfig = await loadUiConfig(auth_.orgId);
  const slack = uiConfig ? readSlackIntegration(uiConfig) : null;
  if (!slack?.webhookUrl) {
    return NextResponse.json({ error: "Slack is not connected" }, { status: 400 });
  }

  const result = await postToSlack(
    slack.webhookUrl,
    "👋 Test from campaign.madeboring.com — this channel will receive your team's campaign notifications."
  );
  if (!result.ok) {
    return NextResponse.json({ error: `Test failed: ${result.detail}` }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const auth_ = await requireSettingsAdmin();
  if ("error" in auth_) return auth_.error;
  const { orgId, session } = auth_;

  const uiConfig = await loadUiConfig(orgId);
  if (!uiConfig) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await saveSlack(orgId, uiConfig, null);

  await logAudit({
    orgId,
    ...createAuditActor(session),
    action: "org.update",
    entityType: "organization",
    entityId: orgId,
    entityLabel: "Slack integration",
    metadata: { integration: "slack", connected: false },
  });

  return NextResponse.json(view(null));
}
