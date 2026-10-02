import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { toCsv, type Cell } from "@/lib/csv";
import { platformLabel } from "@/lib/format";
import { rosterTablesReady } from "@/lib/creators/rosterTables";
import { deriveAverageViewsMeasured } from "@/lib/creatorMetrics";
import { asOfCell, freshnessCell } from "@/lib/dataAge";
import { creatorAvgViewsTime, creatorFollowersTime, type FigureTime } from "@/lib/creators/figureTime";
import { latestTrackerReadings } from "@/lib/creators/latestReadings";
import { metricExportCell, unknownNotes, type MetricValue } from "@/lib/creators/metricValue";
import { linkFollowers, rosterAvgViews, rosterFollowers } from "@/lib/creators/rosterMetrics";

/**
 * The roster as a spreadsheet: one row per creator, one column pair per
 * platform, in the order the ids were given. Shared by the roster export and
 * the list export, so a list downloads with the same columns it was cut from.
 *
 * A figure we do not have is "—", never a blank and never 0 (plan §13 A1), and
 * the "Why a figure is —" column says why, in the same words the roster shows
 * on hover -- both are decided by lib/creators/rosterMetrics. A platform the
 * creator has no account on stays blank in both of its columns: that is no
 * account, not an unknown count.
 *
 * Every row ends with when its two headline figures were measured and by what,
 * and whether that is current (plan A2/A6), dated the way the roster dates them
 * (lib/creators/figureTime). Those columns come after everything else,
 * including the list export's rate card, so no existing column moves.
 */

const PLATFORM_COLUMNS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"] as const;

export type RosterExportOptions = {
  email?: boolean;
  price?: boolean;
  /** Extra trailing columns, keyed by creator id -- the list export's rate card. */
  append?: { header: Cell[]; cells: Map<string, Cell[]> };
};

export async function rosterExportRows(orgId: string, ids: string[], opts: RosterExportOptions = {}): Promise<Cell[][]> {
  const { email = true, price = true, append } = opts;
  const roster = await rosterTablesReady();
  const creators = ids.length
    ? await db.creator.findMany({
        where: { id: { in: ids }, orgId, deletedAt: null },
        select: {
          id: true,
          name: true,
          handle: true,
          platform: true,
          followersCount: true,
          averageViews: true,
          trackerLastAttemptAt: true,
          trackerLastError: true,
          rate: true,
          contactEmail: true,
          addedAt: true,
          tagLinks: { select: { tag: { select: { name: true } } } },
          _count: { select: { posts: true } },
          ...(roster && {
            profileLinks: {
              select: {
                platform: true,
                handle: true,
                url: true,
                followersCount: true,
                isPrimary: true,
                refreshedAt: true,
                refreshError: true,
              },
            },
            detail: { select: { country: true, audienceCountry: true, niche: true } },
          }),
        },
      })
    : [];
  const byId = new Map(creators.map((c) => [c.id, c]));
  // The roster screen's Avg. views: measured from tracked posts, else the account's own page.
  const [derivedAvgViews, readings] = await Promise.all([
    deriveAverageViewsMeasured(creators.map((c) => c.id)),
    latestTrackerReadings(orgId, creators.map((c) => c.id)),
  ]);

  const header: Cell[] = [
    "Name",
    ...PLATFORM_COLUMNS.flatMap((p) => [platformLabel(p), `${platformLabel(p)} followers`]),
    "Followers (primary)",
    "Avg views",
    ...(price ? ["Price per video (USD)"] : []),
    ...(email ? ["Email"] : []),
    "Country",
    "Audience country",
    "Tags",
    "Niche",
    "Added",
    "Why a figure is —",
    ...(append?.header ?? []),
    "Followers as of",
    "Followers source",
    "Avg views as of",
    "Avg views source",
    "Status",
  ];

  const rows = ids.flatMap((id): Cell[][] => {
    const c = byId.get(id);
    if (!c) return [];
    const links = ("profileLinks" in c && c.profileLinks) || [];
    const detail = ("detail" in c && c.detail) || null;
    const facts = {
      trackerLastAttemptAt: c.trackerLastAttemptAt,
      trackerLastError: c.trackerLastError,
      primaryLink: links.find((l) => l.isPrimary) ?? null,
    };
    const followers = rosterFollowers({ followersCount: c.followersCount, ...facts });
    const derived = derivedAvgViews.get(c.id) ?? null;
    const avgViews = rosterAvgViews(derived?.value ?? (c.averageViews || null), c._count?.posts, facts);
    const latestSnapshot = readings.get(c.id) ?? null;
    const followersAt = creatorFollowersTime({ followersCount: c.followersCount, primaryLink: facts.primaryLink, latestSnapshot });
    const avgViewsAt = creatorAvgViewsTime({ derived, averageViews: c.averageViews, primaryLink: facts.primaryLink, latestSnapshot });
    const notes: [string, MetricValue][] = [];
    const accountFor = (platform: string): Cell[] => {
      const link = links.find((l) => l.platform === platform && l.isPrimary) ?? links.find((l) => l.platform === platform);
      if (link) {
        const count = linkFollowers(link);
        notes.push([`${platformLabel(platform)} followers`, count]);
        return [link.url, metricExportCell(count)];
      }
      // A creator from before profile links holds one account on the row
      // itself, so its count is the primary one and its note is that one's.
      if (c.platform === platform) return [`@${c.handle.replace(/^@/, "")}`, metricExportCell(followers)];
      return [null, null];
    };
    const accounts = PLATFORM_COLUMNS.flatMap(accountFor);
    return [
      [
        c.name,
        ...accounts,
        metricExportCell(followers),
        metricExportCell(avgViews),
        ...(price ? [c.rate ?? null] : []),
        ...(email ? [c.contactEmail ?? null] : []),
        detail?.country ?? null,
        detail?.audienceCountry ?? null,
        c.tagLinks.map((t) => t.tag.name).sort().join(", "),
        detail?.niche ?? null,
        c.addedAt.toISOString().slice(0, 10),
        unknownNotes([...notes, ["Followers (primary)", followers], ["Avg views", avgViews]]) || null,
        ...(append ? (append.cells.get(id) ?? append.header.map(() => null)) : []),
        asOfCell(followersAt.at),
        figureSource(followersAt),
        asOfCell(avgViewsAt.at),
        figureSource(avgViewsAt),
        figureStatus(followersAt),
      ],
    ];
  });

  return [header, ...rows];
}

/** The Source cell: what measured it, or, with no time, why there is none. */
function figureSource(t: FigureTime): string {
  return t.at ? t.source : t.missing.charAt(0).toUpperCase() + t.missing.slice(1);
}

/**
 * Status of the primary figure: Current or Stale against its cadence, "Not
 * read" when there is no figure, "Age unknown" when there is one we cannot date.
 */
function figureStatus(t: FigureTime): string {
  if (t.at) return freshnessCell(t.at, t.field);
  return t.source === "Not read" ? "Not read" : "Age unknown";
}

export function spreadsheetResponse(rows: Cell[][], format: "csv" | "xlsx", baseName: string): Response {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = baseName.replace(/[^\w .-]+/g, "").trim().slice(0, 80) || "creators";
  if (format === "csv") {
    return new Response(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safe} ${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  // xlsx stores every string as text, never as a formula, so it needs no
  // injection guard; the CSV path above has one.
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows.map((r) => r.map((v) => v ?? null))), "Creators");
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safe} ${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
