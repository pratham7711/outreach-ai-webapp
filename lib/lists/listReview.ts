import { db } from "@/lib/db";
import { deriveEngagementRates } from "@/lib/creatorMetrics";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { listApprovalTablesReady } from "@/lib/lists/approvalTables";
import {
  countDecisions,
  parseDecision,
  rollupStatus,
  type DecisionCounts,
  type ListItemDecision,
  type ListStatus,
} from "@/lib/lists/approval";
import { parseShareReview, platformIncluded, type ShareReview } from "@/lib/lists/shareSettings";
import type { SharedCreator, SharedList } from "@/lib/lists/listShare";

/**
 * The read side of the list-approval tables, for the agency's pages and the
 * public share page alike.
 *
 * Every caller asks listApprovalTablesReady() first and skips all of this when
 * it is false, so a database without the tables serves Lists exactly as before.
 * A creator with no CreatorListItemDetail row is simply undecided, unpriced and
 * unordered -- the row is only written when someone sets one of those.
 */

export type ItemDetail = {
  rate: number | null;
  notes: string | null;
  sortOrder: number | null;
  decision: ListItemDecision;
  decisionNote: string | null;
  decidedAt: Date | null;
};

export const BLANK_ITEM_DETAIL: ItemDetail = {
  rate: null,
  notes: null,
  sortOrder: null,
  decision: "PENDING",
  decisionNote: null,
  decidedAt: null,
};

export type ListSummary = {
  status: ListStatus;
  counts: DecisionCounts;
  isFavorite: boolean;
  archived: boolean;
};

/** One list's detail rows, keyed by CreatorListItem id. */
export async function listItemDetails(orgId: string, listId: string): Promise<Map<string, ItemDetail>> {
  const rows = await db.creatorListItemDetail.findMany({
    where: { orgId, listId },
    select: { itemId: true, rate: true, notes: true, sortOrder: true, decision: true, decisionNote: true, decidedAt: true },
  });
  return new Map(rows.map(({ itemId, decision, ...r }) => [itemId, { ...r, decision: parseDecision(decision) }]));
}

export const itemDetailOf = (details: Map<string, ItemDetail>, itemId: string): ItemDetail =>
  details.get(itemId) ?? BLANK_ITEM_DETAIL;

/**
 * Pitch order: rows someone has dragged into place first, by sortOrder, then
 * everything else in the order it arrived (callers pass items newest first,
 * as the plain list always showed them). A creator added after a reorder has
 * no sortOrder and so lands at the end, which is where a new pitch row belongs.
 */
export function pitchOrder<T extends { id: string }>(items: T[], details: Map<string, ItemDetail>): T[] {
  const rank = (item: T) => details.get(item.id)?.sortOrder ?? Number.POSITIVE_INFINITY;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

/** Live (unrevoked) share links among these lists. Absent roster tables mean none. */
async function liveShares(orgId: string, listIds: string[]): Promise<Set<string>> {
  if (!listIds.length || !(await rosterTablesReady())) return new Set();
  const rows = await db.creatorListShare.findMany({
    where: { orgId, listId: { in: listIds }, revokedAt: null },
    select: { listId: true },
  });
  return new Set(rows.map((r) => r.listId));
}

/**
 * Status, decision counts, favourite and archived for each list, in three
 * grouped reads however many lists there are. `total` comes from the caller's
 * own _count so that a list with no detail rows still counts its creators as
 * pending.
 */
export async function listSummaries(orgId: string, lists: { id: string; total: number }[]): Promise<Map<string, ListSummary>> {
  const ids = lists.map((l) => l.id);
  const out = new Map<string, ListSummary>();
  if (!ids.length) return out;
  const [details, decided, shared] = await Promise.all([
    db.creatorListDetail.findMany({ where: { orgId, listId: { in: ids } }, select: { listId: true, isFavorite: true, archivedAt: true } }),
    db.creatorListItemDetail.groupBy({
      by: ["listId", "decision"],
      where: { orgId, listId: { in: ids }, decision: { in: ["APPROVED", "REJECTED"] } },
      _count: { _all: true },
    }),
    liveShares(orgId, ids),
  ]);
  const detailBy = new Map(details.map((d) => [d.listId, d]));
  for (const { id, total } of lists) {
    const approved = decided.find((g) => g.listId === id && g.decision === "APPROVED")?._count._all ?? 0;
    const rejected = decided.find((g) => g.listId === id && g.decision === "REJECTED")?._count._all ?? 0;
    const counts: DecisionCounts = { total, approved, rejected, pending: Math.max(0, total - approved - rejected) };
    const d = detailBy.get(id);
    const archived = Boolean(d?.archivedAt);
    out.set(id, {
      status: rollupStatus(counts, { archived, hasShareLink: shared.has(id) }),
      counts,
      isFavorite: d?.isFavorite ?? false,
      archived,
    });
  }
  return out;
}

/** One list's summary from its already-loaded items, for the detail page and the share page. */
export async function listSummary(
  orgId: string,
  listId: string,
  itemIds: string[],
  details: Map<string, ItemDetail>,
): Promise<ListSummary & { duplicatedFromId: string | null }> {
  const [detail, shared] = await Promise.all([
    db.creatorListDetail.findFirst({ where: { listId, orgId }, select: { isFavorite: true, archivedAt: true, duplicatedFromId: true } }),
    liveShares(orgId, [listId]),
  ]);
  const counts = countDecisions(itemIds.map((id) => ({ decision: itemDetailOf(details, id).decision })));
  const archived = Boolean(detail?.archivedAt);
  return {
    status: rollupStatus(counts, { archived, hasShareLink: shared.has(listId) }),
    counts,
    isFavorite: detail?.isFavorite ?? false,
    archived,
    duplicatedFromId: detail?.duplicatedFromId ?? null,
  };
}

/**
 * The review switches behind a token. loadListShare deliberately returns only
 * the four display fields, so this reads the stored JSON for the nested
 * `review` object itself.
 */
export async function shareReviewSettings(token: string): Promise<ShareReview> {
  const row = await db.creatorListShare.findUnique({ where: { token }, select: { fields: true } });
  return parseShareReview(row?.fields);
}

export type SharedVerdict = {
  decision: ListItemDecision;
  /** Present only while the link takes feedback; the agency's own notes never cross. */
  note: string | null;
  engagementRate: number | null;
};

export type SharedReview = {
  settings: ShareReview;
  /** Archived: the page still renders, but verdicts are closed. */
  closed: boolean;
  counts: DecisionCounts;
  /** Sum of the rates shown, or null when rates are hidden, the total is off, or nothing is priced. */
  rateTotal: number | null;
  verdicts: Record<string, SharedVerdict>;
};

/**
 * The review layer on top of sharedListCreators(): the list's own rate in
 * place of the roster's, the pitch order, the platform filter, and each
 * creator's verdict. Done here, on the server, for the same reason
 * sharedListCreators strips fields: anything handed to the page is published.
 *
 * Returns the creators untouched and no review when the tables are not there.
 */
export async function applyShareReview(
  share: SharedList,
  creators: SharedCreator[],
): Promise<{ creators: SharedCreator[]; review: SharedReview | null }> {
  if (!(await listApprovalTablesReady())) return { creators, review: null };
  const settings = await shareReviewSettings(share.token);

  const items = await db.creatorListItem.findMany({
    where: { listId: share.listId, creator: { orgId: share.orgId, deletedAt: null } },
    select: { id: true, creatorId: true },
  });
  const itemBy = new Map(items.map((i) => [i.creatorId, i.id]));
  const details = await listItemDetails(share.orgId, share.listId);
  const detailFor = (creatorId: string) => itemDetailOf(details, itemBy.get(creatorId) ?? "");

  const ordered = pitchOrder(
    creators.map((c) => ({ ...c, id: itemBy.get(c.id) ?? c.id, creatorId: c.id })),
    details,
  ).map(({ creatorId, ...c }) => {
    const rate = share.fields.price ? (detailFor(creatorId).rate ?? c.rate) : null;
    return { ...c, id: creatorId, rate, accounts: c.accounts.filter((a) => platformIncluded(settings, a.platform)) };
  });

  const engagement = settings.engagementRate ? await deriveEngagementRates(ordered.map((c) => c.id)) : new Map<string, number>();
  const summary = await listSummary(share.orgId, share.listId, items.map((i) => i.id), details);

  const verdicts: Record<string, SharedVerdict> = {};
  for (const c of ordered) {
    const d = detailFor(c.id);
    verdicts[c.id] = {
      decision: d.decision,
      note: settings.feedback ? d.decisionNote : null,
      engagementRate: engagement.get(c.id) ?? null,
    };
  }
  const priced = ordered.filter((c) => c.rate != null);
  const rateTotal =
    share.fields.price && settings.rateTotal && priced.length ? priced.reduce((sum, c) => sum + (c.rate ?? 0), 0) : null;

  return {
    creators: ordered,
    review: { settings, closed: summary.archived, counts: summary.counts, rateTotal, verdicts },
  };
}

/** What every rate-card route answers before the tables exist. */
export const rateCardNotReady = () =>
  Response.json(
    { error: "Rate cards and client approval aren't set up yet. An admin needs to run the list-approval migration first." },
    { status: 503 },
  );
