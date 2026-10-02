import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { toCsv, type Cell } from "@/lib/csv";
import { platformLabel } from "@/lib/format";
import { rosterTablesReady } from "@/lib/creators/rosterTables";

/**
 * The roster as a spreadsheet: one row per creator, one column pair per
 * platform, in the order the ids were given. Shared by the roster export and
 * the list export, so a list downloads with the same columns it was cut from.
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
          rate: true,
          contactEmail: true,
          addedAt: true,
          tagLinks: { select: { tag: { select: { name: true } } } },
          ...(roster && {
            profileLinks: { select: { platform: true, handle: true, url: true, followersCount: true, isPrimary: true } },
            detail: { select: { country: true, audienceCountry: true, niche: true } },
          }),
        },
      })
    : [];
  const byId = new Map(creators.map((c) => [c.id, c]));

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
    ...(append?.header ?? []),
  ];

  const rows = ids.flatMap((id): Cell[][] => {
    const c = byId.get(id);
    if (!c) return [];
    const links = ("profileLinks" in c && c.profileLinks) || [];
    const detail = ("detail" in c && c.detail) || null;
    const accountFor = (platform: string) => {
      const link = links.find((l) => l.platform === platform && l.isPrimary) ?? links.find((l) => l.platform === platform);
      if (link) return [link.url, link.followersCount ?? null];
      // A creator from before profile links holds one account on the row itself.
      if (c.platform === platform) return [`@${c.handle.replace(/^@/, "")}`, c.followersCount || null];
      return [null, null];
    };
    return [
      [
        c.name,
        ...PLATFORM_COLUMNS.flatMap(accountFor),
        c.followersCount || null,
        c.averageViews || null,
        ...(price ? [c.rate ?? null] : []),
        ...(email ? [c.contactEmail ?? null] : []),
        detail?.country ?? null,
        detail?.audienceCountry ?? null,
        c.tagLinks.map((t) => t.tag.name).sort().join(", "),
        detail?.niche ?? null,
        c.addedAt.toISOString().slice(0, 10),
        ...(append ? (append.cells.get(id) ?? append.header.map(() => null)) : []),
      ],
    ];
  });

  return [header, ...rows];
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
