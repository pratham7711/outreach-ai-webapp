import { db } from "@/lib/db";
import { stripAt } from "@/lib/format";
import { handleProblem } from "@/lib/creators/handleCheck";
import { accountIdTablesReady } from "@/lib/creators/accountIdTables";

/**
 * A read-only health check of one org's roster, for the admin audit route.
 * Every sample is a handle, never a name or an email: the output is read in a
 * terminal, and the roster belongs to a client.
 */

const SAMPLE = 15;

export type AuditCheck = { count: number; sample: string[] };

export type RosterAudit = {
  creators: number;
  withEmail: number;
  withPicture: number;
  links: { total: number; byPlatform: Record<string, number> };
  checks: Record<AuditCheckName, AuditCheck>;
  /** Every duplicate row (all but the oldest of each set), counted by the day
      it was created and by what created it -- which is the "why". */
  duplicateOrigins: Record<string, number>;
};

export const AUDIT_CHECKS = [
  "nameMissingOrPlaceholder",
  "handleDoubleAt",
  "handleNotAHandle",
  "noProfileLinks",
  "noPrimaryLink",
  "linkFollowersUnder1000",
  "linkFollowersOver20M",
  "linkCountHasFraction",
  "rateOver10000",
  "countryMixedCase",
  "handleProblem",
  "pictureMissing",
  "duplicateEmail",
  "duplicateHandle",
  "duplicateViaProfileLink",
  "duplicatePlatformAccount",
  "sameHandleOtherPlatform",
] as const;

export type AuditCheckName = (typeof AUDIT_CHECKS)[number];

const PLACEHOLDER_NAMES = new Set(["", "name", "unknown", "n/a", "na", "none", "-"]);
const MIXED_CASE = /\p{Ll}\p{Lu}/u;
const NOT_A_HANDLE = /[\s/?#=]|https?:|\.com\b/i;

const at = (h: string) => `@${stripAt(h)}`;
const bare = (h: string) => stripAt(h).trim().toLowerCase();

/* Prisma's cuid() leads with the creation time in base 36. Creator has no
   createdAt column, and this is the only record of when a row appeared. */
export function cuidDay(id: string): string | null {
  if (!/^c[a-z0-9]{24}$/.test(id)) return null;
  const ms = parseInt(id.slice(1, 9), 36);
  return Number.isFinite(ms) && ms > 1.5e12 && ms < 4e12 ? new Date(ms).toISOString().slice(0, 10) : null;
}

type Row = { id: string; name: string; handle: string; platform: string | null; source: string | null };

/* What most likely made a row, from what each path leaves behind: a post link
   names the creator by their handle (ensureCreatorForHandle), and an import or
   sign-up records its source on the detail row. */
function origin(r: Row): string {
  if (r.source) return `source:${r.source}`;
  if (bare(r.name) === bare(r.handle)) return "named-by-handle (post link or DM join)";
  return "no source";
}

export async function auditRoster(orgId: string): Promise<RosterAudit> {
  const creators = await db.creator.findMany({
    where: { orgId, deletedAt: null },
    select: {
      id: true,
      name: true,
      handle: true,
      platform: true,
      contactEmail: true,
      rate: true,
      avatarUrl: true,
      avatar: { select: { fetchedAt: true } },
      detail: { select: { country: true, audienceCountry: true, source: true } },
      profileLinks: {
        select: { platform: true, handle: true, followersCount: true, averageViews: true, isPrimary: true, refreshError: true },
      },
    },
  });

  const checks = Object.fromEntries(AUDIT_CHECKS.map((k) => [k, { count: 0, sample: [] as string[] }])) as Record<
    AuditCheckName,
    AuditCheck
  >;
  const hit = (k: AuditCheckName, label: string) => {
    checks[k].count++;
    if (checks[k].sample.length < SAMPLE) checks[k].sample.push(label);
  };

  const byPlatform: Record<string, number> = {};
  const byEmail = new Map<string, string[]>();
  let links = 0;
  let withEmail = 0;
  let withPicture = 0;

  for (const c of creators) {
    const who = at(c.handle);
    if (PLACEHOLDER_NAMES.has(c.name.trim().toLowerCase())) hit("nameMissingOrPlaceholder", who);
    if (c.handle.trim().startsWith("@@")) hit("handleDoubleAt", c.handle);
    if (NOT_A_HANDLE.test(stripAt(c.handle))) hit("handleNotAHandle", who);
    if (c.rate != null && c.rate > 10000) hit("rateOver10000", `${who} ${c.rate}`);
    if (c.avatar?.fetchedAt || c.avatarUrl) withPicture++;
    else hit("pictureMissing", who);

    for (const v of [c.detail?.country, c.detail?.audienceCountry]) {
      if (v && MIXED_CASE.test(v)) {
        hit("countryMixedCase", `${who} ${v}`);
        break;
      }
    }

    const email = c.contactEmail?.trim().toLowerCase();
    if (email) {
      withEmail++;
      byEmail.set(email, [...(byEmail.get(email) ?? []), who]);
    }

    if (!c.profileLinks.length) hit("noProfileLinks", who);
    else if (!c.profileLinks.some((l) => l.isPrimary)) hit("noPrimaryLink", who);

    for (const l of c.profileLinks) {
      links++;
      byPlatform[l.platform] = (byPlatform[l.platform] ?? 0) + 1;
      const label = `${l.platform.toLowerCase()} ${at(l.handle)}`;
      const f = l.followersCount;
      if (f != null && f > 0 && f < 1000) hit("linkFollowersUnder1000", `${label} ${f}`);
      if (f != null && f > 20_000_000) hit("linkFollowersOver20M", `${label} ${f}`);
      if ([f, l.averageViews].some((n) => n != null && !Number.isInteger(n))) hit("linkCountHasFraction", label);
      if (handleProblem(l.platform, l.refreshError)) hit("handleProblem", label);
      if (NOT_A_HANDLE.test(stripAt(l.handle))) hit("handleNotAHandle", label);
    }
  }

  for (const whos of byEmail.values()) {
    if (whos.length > 1) for (const who of whos) hit("duplicateEmail", who);
  }

  const rows: Row[] = creators.map((c) => ({
    id: c.id,
    name: c.name,
    handle: c.handle,
    platform: c.platform ?? null,
    source: c.detail?.source ?? null,
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const duplicateOrigins: Record<string, number> = {};
  const extra = new Set<string>();
  /* Oldest first, so the row a set keeps counting as "the" creator is the one
     that was there before; every later one is a duplicate and is explained. */
  const oldestFirst = (ids: string[]) => [...new Set(ids)].sort();
  const explain = (ids: string[]) => {
    for (const id of oldestFirst(ids).slice(1)) {
      if (extra.has(id)) continue;
      extra.add(id);
      const r = byId.get(id);
      if (!r) continue;
      const key = `${cuidDay(id) ?? "unknown day"} · ${origin(r)}`;
      duplicateOrigins[key] = (duplicateOrigins[key] ?? 0) + 1;
    }
  };

  // Same platform, same handle, two roster rows.
  const byHandle = new Map<string, string[]>();
  const platformsByHandle = new Map<string, Set<string>>();
  for (const r of rows) {
    const h = bare(r.handle);
    if (!h || !r.platform) continue;
    const key = `${r.platform}:${h}`;
    byHandle.set(key, [...(byHandle.get(key) ?? []), r.id]);
    platformsByHandle.set(h, (platformsByHandle.get(h) ?? new Set()).add(r.platform));
  }
  for (const [key, ids] of byHandle) {
    if (ids.length < 2) continue;
    const cut = key.indexOf(":");
    const platform = key.slice(0, cut);
    const h = key.slice(cut + 1);
    hit("duplicateHandle", `${platform.toLowerCase()} @${h} x${ids.length}`);
    explain(ids);
  }
  // One handle on several platforms: often one person, sometimes two. Not explained as duplicates.
  for (const [h, platforms] of platformsByHandle) {
    if (platforms.size > 1) hit("sameHandleOtherPlatform", `@${h} ${[...platforms].sort().join("+").toLowerCase()}`);
  }

  // A creator whose own account is already another creator's profile link.
  const linkHolder = new Map<string, string>();
  for (const c of creators) for (const l of c.profileLinks) linkHolder.set(`${l.platform}:${bare(l.handle)}`, c.id);
  for (const r of rows) {
    if (!r.platform) continue;
    const holder = linkHolder.get(`${r.platform}:${bare(r.handle)}`);
    if (holder && holder !== r.id) {
      hit("duplicateViaProfileLink", `${r.platform.toLowerCase()} @${bare(r.handle)}`);
      explain([holder, r.id]);
    }
  }

  // The platform's own account id, read by the tracker, under two creators.
  if (await accountIdTablesReady()) {
    try {
      const ids = await db.creatorPlatformAccountId.findMany({
        where: { orgId, creator: { deletedAt: null } },
        select: { creatorId: true, platform: true, platformAccountId: true, handle: true },
      });
      const byAccount = new Map<string, { creators: Set<string>; handle: string | null }>();
      for (const a of ids) {
        const key = `${a.platform}:${a.platformAccountId}`;
        const e = byAccount.get(key) ?? { creators: new Set<string>(), handle: a.handle };
        e.creators.add(a.creatorId);
        byAccount.set(key, e);
      }
      for (const [key, e] of byAccount) {
        if (e.creators.size < 2) continue;
        hit("duplicatePlatformAccount", `${key.split(":")[0].toLowerCase()} ${e.handle ? at(e.handle) : "(no handle)"} x${e.creators.size}`);
        explain([...e.creators]);
      }
    } catch {
      /* The account-id read is a bonus; the handle checks above stand alone. */
    }
  }

  return { creators: creators.length, withEmail, withPicture, links: { total: links, byPlatform }, checks, duplicateOrigins };
}
