import { db } from "@/lib/db";
import { ACCOUNT_ORIGINS } from "@/lib/platforms/accountOrigin";
import { InstagramAuthError } from "@/lib/platforms/instagram";
import { instagramReadTokens, withReadToken } from "@/lib/platforms/instagramReadToken";
import { fetchInstagramAccount } from "@/lib/platforms/instagramAccount";
import { emptyMix, readInstagramAudience } from "@/lib/platforms/instagramAccountInsights";
import { connectionForRead } from "./connectionGate";
import { audienceReady, saveAudienceReadings } from "./audienceSnapshots";
import { createLogger } from "@/lib/observability/logger";

/**
 * Reads the audience of every creator who connected Instagram through Facebook
 * Login and granted it to the org running them, once a week, and saves it
 * (lib/creators/audienceSnapshots.ts).
 *
 * Weekly because Instagram's engaged audience is read over "this_week": one
 * reading every seven days covers every week back to back, which is what a
 * campaign's estimate needs to match each post to the week it went out.
 * Instagram cannot be asked about a past week later, so a missed week stays
 * missed. Run hourly; each run takes only the connections that are due.
 *
 * Instagram Login rows (no Facebook Page) are skipped: their token does not
 * answer on graph.facebook.com, where these metrics are read.
 */

export const AUDIENCE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** A margin so an hourly run that lands a few minutes early still counts it due. */
const DUE_SLACK_MS = 2 * 60 * 60 * 1000;
const PER_RUN = 25;
const BUDGET_MS = 240_000;

export type AudienceSweepResult = {
  ready: boolean;
  due: number;
  read: number;
  empty: number;
  skipped: number;
  failed: number;
  failures: Array<{ connectionId: string; reason: string }>;
};

const log = createLogger({ context: { call: "creator.audience.sweep" } });

export async function sweepCreatorAudience({
  now = new Date(),
  dryRun = false,
  limit = PER_RUN,
}: { now?: Date; dryRun?: boolean; limit?: number } = {}): Promise<AudienceSweepResult> {
  const result: AudienceSweepResult = { ready: false, due: 0, read: 0, empty: 0, skipped: 0, failed: 0, failures: [] };
  if (!(await audienceReady())) return result;
  result.ready = true;

  const connections = await db.creatorSocialAccount.findMany({
    where: {
      platform: "INSTAGRAM",
      /* null is a row from before origins were recorded: Facebook Login, the
         only flow there was then (lib/platforms/accountOrigin). */
      OR: [{ origin: ACCOUNT_ORIGINS.OAUTH }, { origin: null }],
      creator: { deletedAt: null },
    },
    select: { id: true, creatorId: true, creator: { select: { orgId: true } } },
  });
  if (connections.length === 0) return result;

  const latest = await db.creatorAudienceSnapshot.groupBy({
    by: ["connectionId", "orgId"],
    where: { connectionId: { in: connections.map((c) => c.id) } },
    _max: { readAt: true },
  });
  const lastRead = new Map(latest.map((l) => [`${l.connectionId}:${l.orgId}`, l._max.readAt?.getTime() ?? 0]));
  const cutoff = now.getTime() - AUDIENCE_INTERVAL_MS + DUE_SLACK_MS;
  const due = connections
    .map((c) => ({ ...c, orgId: c.creator.orgId, last: lastRead.get(`${c.id}:${c.creator.orgId}`) ?? 0 }))
    .filter((c) => c.last < cutoff)
    .sort((a, b) => a.last - b.last);
  result.due = due.length;

  const started = Date.now();
  for (const c of due.slice(0, limit)) {
    if (Date.now() - started > BUDGET_MS) break;
    try {
      const read = await connectionForRead(c.orgId, c.creatorId, "INSTAGRAM", { where: { id: c.id } });
      if (!read.ok) {
        result.skipped++;
        continue;
      }
      const tokens = await instagramReadTokens(read.connection, c.orgId);
      const token = tokens.user ?? tokens.page;
      if (!token) {
        result.skipped++;
        continue;
      }
      const igUserId = read.connection.platformUserId ?? (await fetchInstagramAccount(token))?.igUserId ?? null;
      if (!igUserId) {
        result.skipped++;
        continue;
      }
      /* Saved even when Instagram described nothing (under 100 followers), so
         the account waits a week before it is asked again. */
      const readings = (await withReadToken(
        tokens,
        (t) => readInstagramAudience(t, igUserId),
        (rs) => rs.every((r) => emptyMix(r.mix)),
      ))!;
      const described = readings.some((r) => !emptyMix(r.mix));
      if (!described) result.empty++;
      if (!dryRun) {
        const saved = await saveAudienceReadings({
          orgId: c.orgId,
          creatorId: c.creatorId,
          connectionId: c.id,
          platform: "INSTAGRAM",
          readings,
          now,
        });
        if (saved === "unavailable") return { ...result, ready: false };
      }
      if (described) result.read++;
    } catch (err) {
      result.failed++;
      const reason = err instanceof InstagramAuthError ? "auth" : err instanceof Error ? err.message.slice(0, 160) : String(err);
      result.failures.push({ connectionId: c.id, reason });
      log.warn("Could not read a creator's Instagram audience", { connectionId: c.id, reason });
    }
  }
  return result;
}
