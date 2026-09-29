import { db } from "@/lib/db";
import { stripAt } from "@/lib/format";
import { handleProblem } from "@/lib/creators/handleCheck";

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
] as const;

export type AuditCheckName = (typeof AUDIT_CHECKS)[number];

const PLACEHOLDER_NAMES = new Set(["", "name", "unknown", "n/a", "na", "none", "-"]);
const MIXED_CASE = /\p{Ll}\p{Lu}/u;
const NOT_A_HANDLE = /[\s/?#=]|https?:|\.com\b/i;

const at = (h: string) => `@${stripAt(h)}`;

export async function auditRoster(orgId: string): Promise<RosterAudit> {
  const creators = await db.creator.findMany({
    where: { orgId },
    select: {
      id: true,
      name: true,
      handle: true,
      contactEmail: true,
      rate: true,
      avatarUrl: true,
      avatar: { select: { fetchedAt: true } },
      detail: { select: { country: true, audienceCountry: true } },
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

  return { creators: creators.length, withEmail, withPicture, links: { total: links, byPlatform }, checks };
}
