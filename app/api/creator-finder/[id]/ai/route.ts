import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma";
import { requireCreatorFinder, noStore } from "@/lib/creatorFinder/gate";
import { permissionDenial } from "@/lib/authz";
import { isMissingProspectTable } from "@/lib/creatorFinder/prospectDdl";
import { readLiveProfile, profileSources } from "@/lib/creatorFinder/liveProfile";
import { INSTAGRAM_AI_WAITING, SCOUT_MODEL, scoutAiClient, scoutAiState } from "@/lib/creatorFinder/scoutAi";
import { inputDigest, readProfileSignals, readStoredTags, ScoutAiAnswerError, type StoredAiTags } from "@/lib/creatorFinder/aiTags";
import { draftFirstMessage } from "@/lib/creatorFinder/aiDraft";
import { findJoinableCampaign } from "@/lib/creatorFinder/campaigns";
import { createLogger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const log = createLogger({ context: { call: "creatorFinder.ai" } });
const EXAMPLE_MAX = 2000;

function refuse(status: number, error: string, reason: string) {
  return NextResponse.json({ error, reason }, { status, headers: noStore });
}

/**
 * POST /api/creator-finder/[id]/ai -- Scout's AI on one prospect.
 *
 *   { task: "read" }  tags for what they make, and contact routes, each quoting
 *                     the profile. The tags are kept on the card (labels and
 *                     sources only, lib/creatorFinder/aiTags.ts); the quotes
 *                     and contacts are answered, not stored.
 *   { task: "draft", example, campaignId? }
 *                     a grounded first message, with the campaign's join link
 *                     under it. Answered, never stored, never sent.
 *
 * The profile is read live first, exactly as the drawer reads it. Both tasks
 * cost a model call, so they need the same permission as working the board.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCreatorFinder(req);
  if (auth instanceof NextResponse) return auth;
  const denied = permissionDenial(auth, "creators:create");
  if (denied) return denied;
  const { orgId, userId } = auth;
  const { id } = await params;

  const body = (await req.json().catch(() => null)) as { task?: unknown; example?: unknown; campaignId?: unknown } | null;
  const task = body?.task;
  if (task !== "read" && task !== "draft") return refuse(400, "bad_task", 'task must be "read" or "draft".');

  const ai = await scoutAiState(orgId);
  if (!ai.on) return refuse(ai.code === "ai_not_configured" ? 503 : 403, ai.code ?? "ai_off", ai.reason ?? "Scout's AI is off.");

  let prospect;
  try {
    prospect = await db.creatorProspect.findFirst({ where: { id, orgId } });
  } catch (e) {
    if (isMissingProspectTable(e)) return refuse(503, "not_set_up", "Creator Finder's tables aren't on this database yet.");
    throw e;
  }
  if (!prospect) return refuse(404, "not_found", "This card is no longer on the board.");
  if (prospect.platform === "INSTAGRAM" && !ai.instagram) return refuse(409, "ai_instagram_waiting", INSTAGRAM_AI_WAITING);

  let campaign = null;
  if (task === "draft" && typeof body?.campaignId === "string" && body.campaignId) {
    campaign = await findJoinableCampaign(auth, body.campaignId);
    if (!campaign) return refuse(404, "campaign_not_joinable", "That campaign has no join link any more. Pick another.");
  }

  const read = await readLiveProfile(orgId, prospect);
  if (!read.ok) return refuse(read.status, read.error, read.reason);

  try {
    const client = scoutAiClient();
    if (task === "read") {
      const sources = profileSources(read);
      const previous = readStoredTags(prospect.aiTags);
      const signals = await readProfileSignals({ client, sources, platform: prospect.platform, rejected: previous?.rejected });
      const stored: StoredAiTags = {
        tags: signals.tags.map(({ kind, label, source }) => ({ kind, label, source })),
        rejected: previous?.rejected ?? [],
        model: SCOUT_MODEL,
        at: new Date().toISOString(),
        inputDigest: inputDigest(sources),
      };
      await db.creatorProspect.update({ where: { id: prospect.id }, data: { aiTags: stored as unknown as Prisma.InputJsonObject } });
      log.info("Scout AI read a profile", { platform: prospect.platform, tags: signals.tags.length, contacts: signals.contacts.length, dropped: signals.dropped, userId });
      const label = new Map(sources.map((s) => [s.id, s.label]));
      return NextResponse.json(
        {
          tags: signals.tags.map((t) => ({ ...t, sourceLabel: label.get(t.source) ?? t.source })),
          contacts: signals.contacts.map((c) => ({ ...c, sourceLabel: label.get(c.source) ?? c.source })),
          dropped: signals.dropped,
          model: stored.model,
          at: stored.at,
        },
        { headers: noStore },
      );
    }

    const example = typeof body?.example === "string" ? body.example.slice(0, EXAMPLE_MAX) : "";
    if (!example.trim()) return refuse(400, "no_example", "Send the agency's usual message as the example.");
    const draft = await draftFirstMessage({
      client,
      read,
      handle: prospect.handle,
      example,
      campaign: campaign ? { ...campaign, joinUrl: new URL(campaign.joinPath, req.nextUrl.origin).toString() } : null,
    });
    log.info("Scout AI drafted a first message", { platform: prospect.platform, dropped: draft.dropped, withCampaign: !!campaign, userId });
    return NextResponse.json({ ...draft, at: new Date().toISOString() }, { headers: noStore });
  } catch (e) {
    if (e instanceof ScoutAiAnswerError) return refuse(502, "ai_unusable", `${e.message} Try again.`);
    if (e instanceof Anthropic.RateLimitError) return refuse(429, "ai_busy", "The AI is busy. Try again in a minute.");
    if (e instanceof Anthropic.APIError) {
      log.error("Scout AI call failed", { status: e.status, message: e.message });
      return refuse(502, "ai_unavailable", "The AI didn't answer just now. Try again in a moment.");
    }
    throw e;
  }
}
