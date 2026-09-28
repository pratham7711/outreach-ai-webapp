import { db } from "@/lib/db";
import { rosterTablesReady } from "@/lib/creators/rosterTables";

/**
 * A creator list shared as a public, read-only page (/l/<token>).
 *
 * The link is live: it reads the list's members on every view, so adding a
 * creator to the list shows up without re-sharing. Everything a viewer may not
 * see is left out HERE, on the server -- props cross into the page's RSC
 * payload, so a column that is merely not rendered is still published to anyone
 * who reads the HTML. Contact email is never public and is not a field at all.
 */

export type ListShareFields = {
  /** Follower counts and average views, per account and overall. */
  stats: boolean;
  tags: boolean;
  audienceCountry: boolean;
  /** Price per video. Off by default: it is a negotiating position. */
  price: boolean;
};

export const DEFAULT_SHARE_FIELDS: ListShareFields = { stats: true, tags: true, audienceCountry: true, price: false };

export function parseShareFields(raw: unknown): ListShareFields {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = (key: keyof ListShareFields) => (typeof r[key] === "boolean" ? (r[key] as boolean) : DEFAULT_SHARE_FIELDS[key]);
  return { stats: pick("stats"), tags: pick("tags"), audienceCountry: pick("audienceCountry"), price: pick("price") };
}

export const listSharePath = (token: string) => `/l/${token}`;

export type SharedAccount = {
  platform: string;
  handle: string;
  url: string | null;
  followersCount: number | null;
  averageViews: number | null;
};

export type SharedCreator = {
  id: string;
  name: string;
  handle: string;
  accounts: SharedAccount[];
  followersCount: number | null;
  averageViews: number | null;
  tags: string[];
  audienceCountry: string | null;
  rate: number | null;
};

export type SharedList = {
  token: string;
  listId: string;
  orgId: string;
  name: string;
  description: string | null;
  orgName: string | null;
  fields: ListShareFields;
};

/** The share behind a token, or null when it is unknown, revoked, or the tables are not there yet. */
export async function loadListShare(token: string): Promise<SharedList | null> {
  if (!token || token.length > 200 || !(await rosterTablesReady())) return null;
  const share = await db.creatorListShare.findUnique({
    where: { token },
    select: {
      token: true,
      orgId: true,
      fields: true,
      revokedAt: true,
      list: { select: { id: true, orgId: true, name: true, description: true, org: { select: { name: true } } } },
    },
  });
  // The share's orgId must be its list's: a row that disagrees is not a link to trust.
  if (!share || share.revokedAt || share.list.orgId !== share.orgId) return null;
  return {
    token: share.token,
    listId: share.list.id,
    orgId: share.orgId,
    name: share.list.name,
    description: share.list.description,
    orgName: share.list.org?.name ?? null,
    fields: parseShareFields(share.fields),
  };
}

/** Member ids, for the avatar route: a public link may only show faces on its own list. */
export async function sharedListMemberIds(share: Pick<SharedList, "listId" | "orgId">): Promise<Set<string>> {
  const items = await db.creatorListItem.findMany({
    where: { listId: share.listId, creator: { orgId: share.orgId, deletedAt: null } },
    select: { creatorId: true },
  });
  return new Set(items.map((i) => i.creatorId));
}

export async function sharedListCreators(share: SharedList): Promise<SharedCreator[]> {
  const { fields } = share;
  const items = await db.creatorListItem.findMany({
    where: { listId: share.listId, creator: { orgId: share.orgId, deletedAt: null } },
    orderBy: [{ addedAt: "desc" }, { id: "asc" }],
    select: {
      creator: {
        select: {
          id: true,
          name: true,
          handle: true,
          platform: true,
          followersCount: true,
          averageViews: true,
          rate: true,
          tagLinks: { select: { tag: { select: { name: true } } } },
        },
      },
    },
  });
  const ids = items.map((i) => i.creator.id);
  const [links, details] = await Promise.all([
    db.creatorProfileLink.findMany({
      where: { orgId: share.orgId, creatorId: { in: ids } },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      select: { creatorId: true, platform: true, handle: true, url: true, followersCount: true, averageViews: true },
    }),
    fields.audienceCountry
      ? db.creatorDetail.findMany({ where: { orgId: share.orgId, creatorId: { in: ids } }, select: { creatorId: true, audienceCountry: true } })
      : Promise.resolve([] as { creatorId: string; audienceCountry: string | null }[]),
  ]);
  const linksBy = new Map<string, typeof links>();
  for (const l of links) linksBy.set(l.creatorId, [...(linksBy.get(l.creatorId) ?? []), l]);
  const audienceBy = new Map(details.map((d) => [d.creatorId, d.audienceCountry]));
  const stat = (n: number | null | undefined) => (fields.stats && n ? n : null);

  return items.map(({ creator: c }) => {
    const own = linksBy.get(c.id) ?? [];
    const accounts: SharedAccount[] = (own.length ? own : [{ platform: c.platform, handle: c.handle, url: null, followersCount: c.followersCount, averageViews: null }]).map(
      (l) => ({ platform: l.platform, handle: l.handle.replace(/^@+/, ""), url: l.url, followersCount: stat(l.followersCount), averageViews: stat(l.averageViews) }),
    );
    return {
      id: c.id,
      name: c.name,
      handle: c.handle.replace(/^@+/, ""),
      accounts,
      followersCount: stat(c.followersCount),
      averageViews: stat(c.averageViews),
      tags: fields.tags ? c.tagLinks.map((t) => t.tag.name).sort((a, b) => a.localeCompare(b)) : [],
      audienceCountry: fields.audienceCountry ? (audienceBy.get(c.id) ?? null) : null,
      rate: fields.price ? c.rate : null,
    };
  });
}
