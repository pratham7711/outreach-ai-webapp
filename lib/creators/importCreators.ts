import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Platform } from "@/lib/generated/prisma/client";
import { creatorHandleVariants } from "@/lib/creator-auth";
import { primaryLink, type ImportLink, type ImportPerson, type ImportPlatform } from "@/lib/creators/importParse";
import { formatFull } from "@/lib/format";

/**
 * Putting parsed people onto an org's roster.
 *
 * Two passes over the same code: `planImport` decides, per person, whether
 * they are new, already known with something to add, or already fully known;
 * `applyImport` carries a plan out. The dry run shows the plan, and the commit
 * re-plans its slice right before writing, so what is saved is what was just
 * checked against the database -- not a preview that has since gone stale.
 *
 * An existing creator is only ever filled in, never overwritten: an import is
 * a sign-up sheet, and what the agency typed into a profile by hand wins over
 * what a creator typed into a form. The one exception is a correction: a
 * value an earlier version of the import misread from this same sheet, and
 * that is still exactly what that version wrote (see importParseLegacy).
 */

export type PlanAction = "create" | "update" | "correct" | "unchanged";

export type PlannedPerson = {
  person: ImportPerson;
  action: PlanAction;
  /** Set for update/unchanged: the roster creator this person already is. */
  creatorId: string | null;
  /** That creator's name as the roster has it, which an import never replaces. */
  rosterName: string | null;
  /** Human-readable, for the review table: "adds Instagram", "fills price". */
  changes: string[];
  /** Misread values being put right, before → after: "TikTok followers 17 → 17,300". */
  corrections: string[];
  addLinks: ImportLink[];
  /** Accounts the creator already has, with counts to fill or correct. */
  linkUpdates: { id: string; data: { followersCount?: number; averageViews?: number } }[];
  /** linkKey of the added link to mark primary, when the creator has none yet. */
  primaryKey: string | null;
  addTags: string[];
  fill: {
    name?: string;
    contactEmail?: string;
    rate?: number | null;
    followersCount?: number;
    averageViews?: number;
  };
  detail: "create" | { country?: string | null; audienceCountry?: string | null; niche?: string; signedUpAt?: Date } | null;
};

export type ImportPlan = { people: PlannedPerson[]; newTags: string[] };

const PLATFORM_LABEL: Record<ImportPlatform, string> = {
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  YOUTUBE: "YouTube",
  TWITTER: "X",
};

function linkKey(platform: string, handle: string) {
  return `${platform}:${handle.replace(/^@+/, "").toLowerCase()}`;
}

/** Org tag names, matched case-insensitively so "anime" reuses "Anime". */
async function existingTagNames(orgId: string): Promise<Map<string, { id: string; name: string }>> {
  const defs = await db.creatorTagDef.findMany({ where: { orgId }, select: { id: true, name: true } });
  return new Map(defs.map((d) => [d.name.toLowerCase(), d]));
}

const COUNT_LABEL = { followersCount: "followers", averageViews: "avg views" } as const;

const shown = (v: string | null) => (v ? `“${v}”` : "not set");

/** A price as typed, cents included: "$5.9" must not read as "$6". */
const dollars = (n: number | null) =>
  n == null ? "not set" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

/**
 * `earlier[i]` is people[i] as the first import's parser read the same rows
 * (importParseLegacy). Where the roster still holds exactly that reading and
 * today's parser reads the cell differently, the value is corrected; any
 * other stored value was typed or fetched since, and is left alone.
 */
export async function planImport(
  orgId: string,
  people: ImportPerson[],
  extraTags: string[] = [],
  earlier: (ImportPerson | undefined)[] = [],
): Promise<ImportPlan> {
  const allKeys = new Map<ImportPlatform, Set<string>>();
  for (const p of people) {
    for (const l of p.links) {
      if (!allKeys.has(l.platform)) allKeys.set(l.platform, new Set());
      allKeys.get(l.platform)!.add(l.handle);
    }
  }

  const byPlatform = [...allKeys.entries()];
  const [links, legacy] = byPlatform.length
    ? await Promise.all([
        db.creatorProfileLink.findMany({
          where: {
            orgId,
            creator: { deletedAt: null },
            OR: byPlatform.map(([platform, handles]) => ({ platform: platform as Platform, handle: { in: [...handles] } })),
          },
          select: { creatorId: true, platform: true, handle: true },
        }),
        // Creators from before profile links existed carry one account in
        // Creator.platform/handle, stored as "@x" or "x", in any case.
        db.creator.findMany({
          where: {
            orgId,
            deletedAt: null,
            OR: byPlatform.map(([platform, handles]) => ({
              platform: platform as Platform,
              handle: { in: [...handles].flatMap(creatorHandleVariants), mode: "insensitive" as const },
            })),
          },
          select: { id: true, platform: true, handle: true },
        }),
      ])
    : [[], []];

  const owner = new Map<string, string>();
  for (const c of legacy) owner.set(linkKey(c.platform, c.handle), c.id);
  for (const l of links) owner.set(linkKey(l.platform, l.handle), l.creatorId);

  const matchedIds = [...new Set(owner.values())];
  const existing = matchedIds.length
    ? await db.creator.findMany({
        where: { id: { in: matchedIds }, orgId },
        select: {
          id: true,
          name: true,
          handle: true,
          platform: true,
          contactEmail: true,
          rate: true,
          followersCount: true,
          averageViews: true,
          profileLinks: { select: { id: true, platform: true, handle: true, followersCount: true, averageViews: true } },
          detail: { select: { country: true, audienceCountry: true, niche: true, signedUpAt: true } },
          tagLinks: { select: { tag: { select: { name: true } } } },
        },
      })
    : [];
  const byId = new Map(existing.map((c) => [c.id, c]));

  const tagDefs = await existingTagNames(orgId);
  const newTags = new Set<string>();
  const extras = extraTags.map((t) => t.trim()).filter(Boolean);

  const planned = people.map((person, index): PlannedPerson => {
    const tags = [...new Set([...person.tags, ...extras])];
    for (const t of tags) if (!tagDefs.has(t.toLowerCase())) newTags.add(t);

    const creatorId = person.links.map((l) => owner.get(linkKey(l.platform, l.handle))).find(Boolean) ?? null;
    const creator = creatorId ? byId.get(creatorId) : undefined;
    if (!creator) {
      return {
        person,
        action: "create",
        creatorId: null,
        rosterName: null,
        changes: [],
        corrections: [],
        addLinks: person.links,
        linkUpdates: [],
        primaryKey: linkKey(primaryLink(person.links)!.platform, primaryLink(person.links)!.handle),
        addTags: tags,
        fill: {},
        detail: "create",
      };
    }

    const changes: string[] = [];
    const held = new Set(creator.profileLinks.map((l) => linkKey(l.platform, l.handle)));
    // A legacy creator's own account becomes a link too, so it shows as a chip.
    const addLinks = person.links.filter((l) => {
      const k = linkKey(l.platform, l.handle);
      if (held.has(k)) return false;
      const other = owner.get(k);
      return !other || other === creator.id;
    });
    for (const l of addLinks) {
      if (linkKey(creator.platform, creator.handle) !== linkKey(l.platform, l.handle)) changes.push(`adds ${PLATFORM_LABEL[l.platform]}`);
    }

    const fill: PlannedPerson["fill"] = {};
    const own = person.links.find((l) => linkKey(l.platform, l.handle) === linkKey(creator.platform, creator.handle)) ?? primaryLink(person.links)!;
    const placeholderName = !creator.name.trim() || creator.name.replace(/^@/, "").toLowerCase() === creator.handle.replace(/^@/, "").toLowerCase();
    if (placeholderName && person.name && person.name !== own.handle) {
      fill.name = person.name;
      changes.push("fills name");
    }
    if (!creator.contactEmail && person.email) {
      fill.contactEmail = person.email;
      changes.push("fills email");
    }
    if (creator.rate == null && person.rate != null) {
      fill.rate = person.rate;
      changes.push("fills price");
    }
    if (!creator.followersCount && own.followersCount) {
      fill.followersCount = own.followersCount;
      changes.push("fills followers");
    }
    if (!creator.averageViews && own.averageViews) {
      fill.averageViews = own.averageViews;
      changes.push("fills avg views");
    }

    let detail: PlannedPerson["detail"] = null;
    if (!creator.detail) {
      if (person.country || person.audienceCountry || person.niche || person.signedUpAt) {
        detail = "create";
        changes.push("adds details");
      }
    } else {
      const d: Exclude<PlannedPerson["detail"], "create" | null> = {};
      if (!creator.detail.country && person.country) d.country = person.country;
      if (!creator.detail.audienceCountry && person.audienceCountry) d.audienceCountry = person.audienceCountry;
      if (!creator.detail.niche && person.niche) d.niche = person.niche;
      if (!creator.detail.signedUpAt && person.signedUpAt) d.signedUpAt = person.signedUpAt;
      if (Object.keys(d).length) {
        detail = d;
        changes.push("adds details");
      }
    }

    const heldTags = new Set(creator.tagLinks.map((t) => t.tag.name.toLowerCase()));
    const addTags = tags.filter((t) => !heldTags.has(t.toLowerCase()));
    if (addTags.length) changes.push(`adds ${addTags.length} tag${addTags.length === 1 ? "" : "s"}`);

    // An account the creator already has: its blank counts are filled, and
    // what the first import misread is corrected.
    const was = earlier[index];
    const corrections = new Set<string>();
    const linkUpdates: PlannedPerson["linkUpdates"] = [];
    for (const l of person.links) {
      const key = linkKey(l.platform, l.handle);
      const heldLink = creator.profileLinks.find((h) => linkKey(h.platform, h.handle) === key);
      if (!heldLink) continue;
      const before = was?.links.find((b) => linkKey(b.platform, b.handle) === key);
      const data: PlannedPerson["linkUpdates"][number]["data"] = {};
      for (const k of ["followersCount", "averageViews"] as const) {
        const stored = heldLink[k];
        const now = l[k];
        if (now == null || stored === now) continue;
        if (stored == null) {
          data[k] = now;
          changes.push(`fills ${PLATFORM_LABEL[l.platform]} ${COUNT_LABEL[k]}`);
        } else if (before && stored === before[k]) {
          data[k] = now;
          corrections.add(`${PLATFORM_LABEL[l.platform]} ${COUNT_LABEL[k]} ${formatFull(stored)} → ${formatFull(now)}`);
        }
      }
      if (Object.keys(data).length) linkUpdates.push({ id: heldLink.id, data });
    }

    if (was) {
      // The creator's own figures mirror its main account's, as the first import wrote them.
      const ownBefore = was.links.find((b) => linkKey(b.platform, b.handle) === linkKey(own.platform, own.handle));
      for (const k of ["followersCount", "averageViews"] as const) {
        if (!ownBefore || fill[k] !== undefined) continue;
        const stored = creator[k];
        const now = own[k];
        if (stored && now != null && stored === (ownBefore[k] ?? 0) && now !== stored) {
          fill[k] = now;
          corrections.add(`${PLATFORM_LABEL[own.platform]} ${COUNT_LABEL[k]} ${formatFull(stored)} → ${formatFull(now)}`);
        }
      }
      if (fill.rate === undefined && creator.rate != null && creator.rate === was.rate && person.rate !== was.rate) {
        fill.rate = person.rate;
        corrections.add(`price ${dollars(creator.rate)} → ${dollars(person.rate)}`);
      }
      if (fill.name === undefined && creator.name === was.name && person.name !== was.name) {
        fill.name = person.name;
        corrections.add(`name ${shown(was.name)} → ${shown(person.name)}`);
      }
      if (creator.detail && detail !== "create") {
        const d = detail ?? {};
        for (const [k, label] of [["country", "country"], ["audienceCountry", "audience country"]] as const) {
          const stored = creator.detail[k];
          if (d[k] !== undefined || stored == null || stored !== was[k] || person[k] === was[k]) continue;
          d[k] = person[k];
          corrections.add(`${label} ${shown(stored)} → ${shown(person[k])}`);
        }
        if (Object.keys(d).length) detail = d;
      }
    }

    const action: PlanAction = corrections.size
      ? "correct"
      : addLinks.length || addTags.length || Object.keys(fill).length || detail || linkUpdates.length
        ? "update"
        : "unchanged";
    // A creator that predates profile links has no primary yet; its own account is it.
    const primaryKey = creator.profileLinks.length ? null : linkKey(creator.platform, creator.handle);
    return {
      person,
      action,
      creatorId: creator.id,
      rosterName: fill.name ?? creator.name,
      changes,
      corrections: [...corrections],
      addLinks,
      linkUpdates,
      primaryKey,
      addTags,
      fill,
      detail,
    };
  });

  return { people: planned, newTags: [...newTags].sort() };
}

export type ApplyCounts = { created: number; updated: number; corrected: number; unchanged: number; creatorIds: string[] };

/** Writes one slice of a plan. Safe to repeat: every insert skips what exists. */
export async function applyImport(orgId: string, plan: ImportPlan, source: string): Promise<ApplyCounts> {
  const counts: ApplyCounts = { created: 0, updated: 0, corrected: 0, unchanged: 0, creatorIds: [] };
  const todo = plan.people.filter((p) => p.action !== "unchanged");
  counts.unchanged = plan.people.length - todo.length;
  if (!todo.length) return counts;

  // Tag definitions first and outside the transaction: they are org-wide and
  // idempotent, and a later chunk needs the ones an earlier chunk created.
  const wanted = [...new Set(todo.flatMap((p) => p.addTags))];
  let tags = await existingTagNames(orgId);
  const missing = wanted.filter((t) => !tags.has(t.toLowerCase()));
  if (missing.length) {
    await db.creatorTagDef.createMany({ data: missing.map((name) => ({ orgId, name })), skipDuplicates: true });
    tags = await existingTagNames(orgId);
  }

  await db.$transaction(
    async (tx) => {
      const creates = todo.filter((p) => p.action === "create");
      const newIds = creates.map(() => randomUUID());
      if (creates.length) {
        await tx.creator.createMany({
          data: creates.map((p, i) => {
            const primary = primaryLink(p.person.links)!;
            return {
              id: newIds[i],
              orgId,
              name: p.person.name,
              handle: `@${primary.handle}`,
              platform: primary.platform as Platform,
              followersCount: primary.followersCount ?? 0,
              averageViews: primary.averageViews ?? 0,
              contactEmail: p.person.email,
              rate: p.person.rate,
            };
          }),
        });
        await tx.creatorDetail.createMany({
          data: creates.map((p, i) => ({
            creatorId: newIds[i],
            orgId,
            country: p.person.country,
            audienceCountry: p.person.audienceCountry,
            niche: p.person.niche,
            signedUpAt: p.person.signedUpAt,
            source,
          })),
        });
      }

      const idFor = (p: PlannedPerson) => (p.action === "create" ? newIds[creates.indexOf(p)] : p.creatorId!);

      const linkRows = todo.flatMap((p) => {
        return p.addLinks.map((l) => ({
          creatorId: idFor(p),
          orgId,
          platform: l.platform as Platform,
          handle: l.handle,
          url: l.url,
          followersCount: l.followersCount,
          averageViews: l.averageViews,
          isPrimary: p.primaryKey === linkKey(l.platform, l.handle),
        }));
      });
      if (linkRows.length) {
        // An account still held by a deleted creator would make skipDuplicates
        // drop it silently, leaving the returning creator with no accounts.
        // Nothing restores a deleted creator, so the account moves to the new one.
        const byPlatform = new Map<Platform, string[]>();
        for (const r of linkRows) byPlatform.set(r.platform, [...(byPlatform.get(r.platform) ?? []), r.handle]);
        await tx.creatorProfileLink.deleteMany({
          where: {
            orgId,
            creator: { deletedAt: { not: null } },
            OR: [...byPlatform.entries()].map(([platform, handles]) => ({ platform, handle: { in: handles } })),
          },
        });
        await tx.creatorProfileLink.createMany({ data: linkRows, skipDuplicates: true });
      }

      const tagRows = todo.flatMap((p) =>
        p.addTags.flatMap((t) => {
          const def = tags.get(t.toLowerCase());
          return def ? [{ creatorId: idFor(p), tagId: def.id }] : [];
        }),
      );
      if (tagRows.length) await tx.creatorTagLink.createMany({ data: tagRows, skipDuplicates: true });

      for (const p of todo) {
        if (p.action === "create") continue;
        for (const u of p.linkUpdates) {
          await tx.creatorProfileLink.update({ where: { id: u.id, orgId, creatorId: p.creatorId! }, data: u.data });
        }
        if (Object.keys(p.fill).length) {
          await tx.creator.update({ where: { id: p.creatorId!, orgId }, data: p.fill });
        }
        if (p.detail === "create") {
          await tx.creatorDetail.create({
            data: {
              creatorId: p.creatorId!,
              orgId,
              country: p.person.country,
              audienceCountry: p.person.audienceCountry,
              niche: p.person.niche,
              signedUpAt: p.person.signedUpAt,
              source,
            },
          });
        } else if (p.detail) {
          await tx.creatorDetail.update({ where: { creatorId: p.creatorId!, orgId }, data: p.detail });
        }
      }

      counts.created = creates.length;
      counts.corrected = todo.filter((p) => p.action === "correct").length;
      counts.updated = todo.length - creates.length - counts.corrected;
      counts.creatorIds = todo.map(idFor);
    },
    { timeout: 45_000, maxWait: 10_000 },
  );

  return counts;
}
