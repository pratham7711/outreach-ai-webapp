import type { Platform, Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { isMissingCreatorAudienceTable } from "./audienceDdl";
import {
  AUDIENCE_BREAKDOWNS,
  type AudienceBreakdown,
  type AudienceKind,
  type AudienceMix,
  type AudienceReading,
  type AudienceTimeframe,
  type DemographicRow,
} from "@/lib/platforms/instagramAccountInsights";

/**
 * Every read and write of CreatorAudienceSnapshot.
 *
 * The table arrives after the code (lib/creators/audienceDdl.ts). While it is
 * missing nothing is saved and every reader answers "no audience", so the
 * roster, the creator page and the campaign behave exactly as before.
 */

export type StoredAudience = {
  audience: AudienceKind;
  timeframe: AudienceTimeframe;
  /** YYYY-MM-DD, the UTC day it was read. */
  day: string;
  readAt: string;
  mix: AudienceMix;
};

export async function audienceReady(): Promise<boolean> {
  try {
    await db.creatorAudienceSnapshot.findFirst({ select: { id: true } });
    return true;
  } catch (e) {
    if (isMissingCreatorAudienceTable(e)) return false;
    throw e;
  }
}

function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function rowsOf(value: Prisma.JsonValue): DemographicRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((r) => {
      const o = r as { key?: unknown; value?: unknown };
      return { key: typeof o.key === "string" ? o.key : "", value: typeof o.value === "number" ? o.value : NaN };
    })
    .filter((r) => r.key.length > 0 && Number.isFinite(r.value) && r.value >= 0);
}

type SnapshotRow = {
  audience: string;
  timeframe: string;
  day: Date;
  readAt: Date;
  country: Prisma.JsonValue;
  city: Prisma.JsonValue;
  age: Prisma.JsonValue;
  gender: Prisma.JsonValue;
};

function stored(row: SnapshotRow): StoredAudience {
  const mix = Object.fromEntries(AUDIENCE_BREAKDOWNS.map((b) => [b, rowsOf(row[b])])) as AudienceMix;
  return {
    audience: row.audience as AudienceKind,
    timeframe: row.timeframe as AudienceTimeframe,
    day: row.day.toISOString().slice(0, 10),
    readAt: row.readAt.toISOString(),
    mix,
  };
}

const SNAPSHOT_SELECT = {
  creatorId: true,
  audience: true,
  timeframe: true,
  day: true,
  readAt: true,
  country: true,
  city: true,
  age: true,
  gender: true,
} as const;

/**
 * Saves one reading of every audience Instagram described, as that day's
 * rows. Reading the same day again replaces them.
 */
export async function saveAudienceReadings(input: {
  orgId: string;
  creatorId: string;
  connectionId: string;
  platform: Platform;
  readings: AudienceReading[];
  now?: Date;
}): Promise<"saved" | "unavailable"> {
  const now = input.now ?? new Date();
  const day = utcDay(now);
  try {
    await db.$transaction(
      input.readings.map((r) => {
        const data = {
          country: r.mix.country,
          city: r.mix.city,
          age: r.mix.age,
          gender: r.mix.gender,
          readAt: now,
        };
        return db.creatorAudienceSnapshot.upsert({
          where: {
            connectionId_orgId_audience_timeframe_day: {
              connectionId: input.connectionId,
              orgId: input.orgId,
              audience: r.audience,
              timeframe: r.timeframe,
              day,
            },
          },
          create: {
            orgId: input.orgId,
            creatorId: input.creatorId,
            connectionId: input.connectionId,
            platform: input.platform,
            audience: r.audience,
            timeframe: r.timeframe,
            day,
            ...data,
          },
          update: data,
          select: { id: true },
        });
      }),
    );
    return "saved";
  } catch (e) {
    if (isMissingCreatorAudienceTable(e)) return "unavailable";
    throw e;
  }
}

/** Removes every snapshot taken through these connections, in every org. */
export async function deleteAudienceForConnections(connectionIds: string[]): Promise<number> {
  const ids = [...new Set(connectionIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  try {
    const { count } = await db.creatorAudienceSnapshot.deleteMany({ where: { connectionId: { in: ids } } });
    return count;
  } catch (e) {
    if (isMissingCreatorAudienceTable(e)) return 0;
    throw e;
  }
}

/** The newest reading of each audience and window for one creator in this org. */
export async function latestCreatorAudience(
  orgId: string,
  creatorId: string,
  platform: Platform = "INSTAGRAM",
): Promise<{ ready: boolean; audiences: StoredAudience[] }> {
  try {
    const rows = await db.creatorAudienceSnapshot.findMany({
      where: { orgId, creatorId, platform },
      orderBy: { day: "desc" },
      take: 60,
      select: SNAPSHOT_SELECT,
    });
    const seen = new Set<string>();
    const audiences: StoredAudience[] = [];
    for (const row of rows) {
      const key = `${row.audience}:${row.timeframe}`;
      if (seen.has(key)) continue;
      seen.add(key);
      audiences.push(stored(row));
    }
    return { ready: true, audiences };
  } catch (e) {
    if (isMissingCreatorAudienceTable(e)) return { ready: false, audiences: [] };
    throw e;
  }
}

/** The newest follower reading of each of these creators, for the roster. */
export async function latestFollowerAudiences(
  orgId: string,
  creatorIds: string[],
  platform: Platform = "INSTAGRAM",
): Promise<Map<string, StoredAudience>> {
  const out = new Map<string, StoredAudience>();
  if (creatorIds.length === 0) return out;
  try {
    const rows = await db.creatorAudienceSnapshot.findMany({
      where: { orgId, creatorId: { in: creatorIds }, platform, audience: "followers" },
      orderBy: { day: "desc" },
      select: SNAPSHOT_SELECT,
    });
    for (const row of rows) if (!out.has(row.creatorId)) out.set(row.creatorId, stored(row));
    return out;
  } catch (e) {
    if (isMissingCreatorAudienceTable(e)) return out;
    throw e;
  }
}

/** Every reading of these creators' audiences between two days, for a campaign. */
export async function audienceHistory(
  orgId: string,
  creatorIds: string[],
  from: Date,
  to: Date,
  platform: Platform = "INSTAGRAM",
): Promise<Array<StoredAudience & { creatorId: string }>> {
  if (creatorIds.length === 0) return [];
  try {
    const rows = await db.creatorAudienceSnapshot.findMany({
      where: { orgId, creatorId: { in: creatorIds }, platform, day: { gte: utcDay(from), lte: utcDay(to) } },
      orderBy: { day: "asc" },
      take: 20000,
      select: SNAPSHOT_SELECT,
    });
    return rows.map((r) => ({ ...stored(r), creatorId: r.creatorId }));
  } catch (e) {
    if (isMissingCreatorAudienceTable(e)) return [];
    throw e;
  }
}

export type { AudienceBreakdown };
