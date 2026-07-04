import { db } from "@/lib/db";

/**
 * Public marketplace helpers (Phase 2M / M2).
 *
 * SECURITY: every function here powers UNAUTHENTICATED, cross-org public
 * surfaces (`/explore`, `/api/public/marketplace`). We must NEVER leak org
 * internals. Only the fields in the explicit `select` whitelists below ever
 * reach the wire — never spread a Campaign row.
 *
 * Money convention (P3.1): `ratePerThousand` and `*Minor` fields are integer
 * MINOR units (paise/cents). We convert to MAJOR units only at the display
 * boundary in these helpers. `ViewLedger.amountEarned` is already MAJOR units.
 */

/** Only GLOBAL campaigns are browsable. INVITE_ONLY is joinable by code, not listed. PRIVATE is org-only. */
export const PUBLIC_VISIBILITY = "GLOBAL" as const;

const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
};

export function currencySymbol(currency: string): string {
  return CURRENCY_SYMBOL[currency] ?? "";
}

/** minor units (paise/cents) → major units (rupees/dollars), rounded to 2dp. */
export function minorToMajor(minor: number | null | undefined): number {
  if (minor == null) return 0;
  return Math.round(minor) / 100;
}

/** major units → minor units (integer). */
export function majorToMinor(major: number): number {
  return Math.round(major * 100);
}

export type PlatformRate = {
  platform: string;
  /** major units per 1k verified views, for display */
  ratePerThousand: number;
};

/** Parse the per-platform `ratePerThousand` Json (minor units) into display-ready major-unit rates. */
export function parsePlatformRates(raw: unknown): PlatformRate[] {
  if (!raw || typeof raw !== "object") return [];
  const out: PlatformRate[] = [];
  for (const [platform, value] of Object.entries(raw as Record<string, unknown>)) {
    const minor = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(minor) || minor <= 0) continue;
    out.push({ platform, ratePerThousand: minorToMajor(minor) });
  }
  return out;
}

export type SortKey = "newest" | "rate" | "budget";

/**
 * STRICT public whitelist for a marketplace campaign row. This is the ONLY
 * Prisma select used for the list endpoint — no orgId, client names, notes,
 * budgets in currency, or other financial internals ever selected here.
 */
export const MARKETPLACE_LIST_SELECT = {
  id: true,
  publicSlug: true,
  title: true,
  campaignType: true,
  ratePerThousand: true,
  currency: true,
  marketplaceBudgetCapMinor: true,
  submissionDeadline: true,
  createdAt: true,
  org: { select: { name: true, brandName: true, logoUrl: true } },
  _count: { select: { activations: true } },
} as const;

/**
 * STRICT public whitelist for a single marketplace campaign detail. Adds the
 * brief fields (guidelines, requirements, assets) that only appear on the
 * landing page. Still no org internals / financial internals.
 */
export const MARKETPLACE_DETAIL_SELECT = {
  publicSlug: true,
  title: true,
  campaignType: true,
  ratePerThousand: true,
  currency: true,
  marketplaceBudgetCapMinor: true,
  submissionDeadline: true,
  createdAt: true,
  guidelines: true,
  requirements: true,
  contentAssetsUrl: true,
  autoApproveHours: true,
  minPayoutMinor: true,
  marketplaceVisibility: true,
  org: { select: { name: true, brandName: true, logoUrl: true, primaryColor: true } },
  _count: { select: { activations: true } },
} as const;

export type MarketplaceListRow = {
  id: string;
  publicSlug: string | null;
  title: string;
  campaignType: string;
  ratePerThousand: unknown;
  currency: string;
  marketplaceBudgetCapMinor: number | null;
  submissionDeadline: Date | null;
  createdAt: Date;
  org: { name: string; brandName: string | null; logoUrl: string | null };
  _count: { activations: number };
};

export type MarketplaceCardDTO = {
  slug: string;
  title: string;
  campaignType: string;
  orgName: string;
  orgLogoUrl: string | null;
  currency: string;
  currencySymbol: string;
  rates: PlatformRate[];
  budgetCapMinor: number | null;
  budgetCapMajor: number | null;
  submissionDeadline: string | null;
  creatorCount: number;
  daysLeft: number | null;
  budgetClaimedPct: number | null;
};

/** Whole days from now until an ISO deadline; null if past or absent. */
export function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return null;
  return Math.ceil(ms / 86_400_000);
}

/** Shape a whitelisted row into the wire DTO. Never receives a raw Campaign object. */
export function toCardDTO(row: MarketplaceListRow): MarketplaceCardDTO {
  return {
    slug: row.publicSlug ?? "",
    title: row.title,
    campaignType: row.campaignType,
    orgName: row.org.brandName || row.org.name,
    orgLogoUrl: row.org.logoUrl ?? null,
    currency: row.currency,
    currencySymbol: currencySymbol(row.currency),
    rates: parsePlatformRates(row.ratePerThousand),
    budgetCapMinor: row.marketplaceBudgetCapMinor ?? null,
    budgetCapMajor:
      row.marketplaceBudgetCapMinor != null
        ? minorToMajor(row.marketplaceBudgetCapMinor)
        : null,
    submissionDeadline: row.submissionDeadline ? row.submissionDeadline.toISOString() : null,
    creatorCount: row._count.activations,
    daysLeft: daysUntil(row.submissionDeadline ? row.submissionDeadline.toISOString() : null),
    budgetClaimedPct: null,
  };
}

const VALID_TYPES = new Set([
  "BUDGET_BASED",
  "VIEW_BASED",
  "OPEN_COMMUNITY",
  "PRIVATE_INVITE",
]);
const VALID_PLATFORMS = new Set(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]);

export type MarketplaceListQuery = {
  q?: string;
  platform?: string;
  type?: string;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
};

export type MarketplaceListResult = {
  campaigns: MarketplaceCardDTO[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

/**
 * Shared, auth-free marketplace list query used by BOTH the public API route
 * and the /explore Server Component. Applies the strict whitelist select and
 * in-memory platform filter + rate sort (rate lives in a Json blob).
 */
export async function fetchMarketplaceList(
  query: MarketplaceListQuery
): Promise<MarketplaceListResult> {
  const q = (query.q ?? "").trim();
  const platform = (query.platform ?? "").trim().toUpperCase();
  const type = (query.type ?? "").trim().toUpperCase();
  const sort: SortKey = query.sort ?? "newest";
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(48, Math.max(1, query.pageSize ?? 12));

  const where: Record<string, unknown> = {
    marketplaceVisibility: PUBLIC_VISIBILITY,
    publicSlug: { not: null },
    deletedAt: null,
  };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { org: { name: { contains: q, mode: "insensitive" } } },
      { org: { brandName: { contains: q, mode: "insensitive" } } },
    ];
  }
  if (type && VALID_TYPES.has(type)) {
    where.campaignType = type;
  }

  const rows = (await db.campaign.findMany({
    where,
    select: MARKETPLACE_LIST_SELECT,
    orderBy:
      sort === "budget"
        ? [{ marketplaceBudgetCapMinor: "desc" }, { createdAt: "desc" }]
        : [{ createdAt: "desc" }],
    take: 500,
  })) as unknown as MarketplaceListRow[];

  const idBySlug = new Map(rows.map((r) => [r.publicSlug ?? "", r.id]));
  let cards = rows.map(toCardDTO);

  if (platform && VALID_PLATFORMS.has(platform)) {
    cards = cards.filter((c) => c.rates.some((r) => r.platform.toUpperCase() === platform));
  }

  if (sort === "rate") {
    cards.sort((a, b) => {
      const am = a.rates.reduce((m, r) => Math.max(m, r.ratePerThousand), 0);
      const bm = b.rates.reduce((m, r) => Math.max(m, r.ratePerThousand), 0);
      return bm - am;
    });
  }

  const total = cards.length;
  const start = (page - 1) * pageSize;
  const paged = cards.slice(start, start + pageSize);

  // Enrich only the paged cards with a DERIVED budget-claimed percentage. We
  // never expose raw earned amounts — only the % of the (already-public) cap.
  const cappedIds = paged
    .map((c) => (c.budgetCapMinor != null && c.budgetCapMinor > 0 ? idBySlug.get(c.slug) : undefined))
    .filter((id): id is string => Boolean(id));
  if (cappedIds.length > 0) {
    const grouped = await db.viewLedger.groupBy({
      by: ["campaignId"],
      where: { campaignId: { in: cappedIds } },
      _sum: { amountEarned: true },
    });
    const earnedByCampaign = new Map(
      grouped.map((g) => [g.campaignId, majorToMinor(g._sum.amountEarned ?? 0)])
    );
    for (const c of paged) {
      const id = idBySlug.get(c.slug);
      if (!id || c.budgetCapMinor == null || c.budgetCapMinor <= 0) continue;
      const earnedMinor = earnedByCampaign.get(id) ?? 0;
      c.budgetClaimedPct = Math.min(100, Math.round((earnedMinor / c.budgetCapMinor) * 100));
    }
  }

  return {
    campaigns: paged,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export type LeaderboardEntry = {
  handle: string;
  name: string;
  avatarUrl: string | null;
  verifiedViews: number;
  earnedMajor: number;
  /** Public profile handle (/c/[handle]) — only set when a portal creator exists. */
  profileHandle: string | null;
};

export type MarketplaceDetailResult = {
  campaign: {
    slug: string;
    title: string;
    campaignType: string;
    orgName: string;
    orgLogoUrl: string | null;
    orgPrimaryColor: string;
    currency: string;
    currencySymbol: string;
    rates: PlatformRate[];
    guidelines: string | null;
    requirements: string | null;
    contentAssetsUrl: string | null;
    autoApproveHours: number;
    minPayoutMinor: number | null;
    minPayoutMajor: number | null;
    submissionDeadline: string | null;
    creatorCount: number;
  };
  budget: {
    earnedMinor: number;
    earnedMajor: number;
    capMinor: number | null;
    capMajor: number | null;
  };
  leaderboard: LeaderboardEntry[];
};

/**
 * Shared, auth-free marketplace detail query used by BOTH the public API route
 * and the /explore/[slug] Server Component. PRIVATE / INVITE_ONLY → null (404).
 */
export async function fetchMarketplaceDetail(
  slug: string
): Promise<MarketplaceDetailResult | null> {
  const row = await db.campaign.findFirst({
    where: {
      publicSlug: slug,
      marketplaceVisibility: PUBLIC_VISIBILITY,
      deletedAt: null,
    },
    select: MARKETPLACE_DETAIL_SELECT,
  });
  if (!row) return null;

  const idRow = await db.campaign.findUnique({
    where: { publicSlug: slug },
    select: { id: true },
  });
  const campaignId = idRow?.id ?? "";

  const agg = await db.viewLedger.aggregate({
    where: { campaignId },
    _sum: { amountEarned: true },
  });
  const earnedMajor = agg._sum.amountEarned ?? 0;
  const earnedMinor = Math.round(earnedMajor * 100);

  const grouped = await db.viewLedger.groupBy({
    by: ["creatorId"],
    where: { campaignId },
    _sum: { viewsDelta: true, amountEarned: true },
    orderBy: { _sum: { viewsDelta: "desc" } },
    take: 10,
  });
  const creatorIds = grouped.map((g) => g.creatorId);
  const creators =
    creatorIds.length > 0
      ? await db.creator.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, handle: true, name: true, avatarUrl: true },
        })
      : [];
  const creatorLookup = new Map(creators.map((c) => [c.id, c]));

  // A leaderboard entry links to /c/[handle] only when a portal creator with
  // that handle exists. Org-side Creator.handle may carry a leading "@" that
  // the portal CreatorUser.handle does not — normalize before matching.
  const normalizeHandle = (h: string | null | undefined) =>
    (h ?? "").replace(/^@+/, "").trim();
  const normalizedHandles = Array.from(
    new Set(creators.map((c) => normalizeHandle(c.handle)).filter(Boolean))
  );
  const portalUsers =
    normalizedHandles.length > 0
      ? await db.creatorUser.findMany({
          where: { handle: { in: normalizedHandles } },
          select: { handle: true },
        })
      : [];
  const portalHandleSet = new Set(portalUsers.map((u) => u.handle));

  const leaderboard: LeaderboardEntry[] = grouped.map((g) => {
    const c = creatorLookup.get(g.creatorId);
    const normalized = normalizeHandle(c?.handle);
    return {
      handle: c?.handle ?? "creator",
      name: c?.name ?? "Creator",
      avatarUrl: c?.avatarUrl ?? null,
      verifiedViews: g._sum.viewsDelta ?? 0,
      earnedMajor: g._sum.amountEarned ?? 0,
      profileHandle: normalized && portalHandleSet.has(normalized) ? normalized : null,
    };
  });

  const capMinor = (row as unknown as MarketplaceListRow).marketplaceBudgetCapMinor ?? null;

  return {
    campaign: {
      slug: row.publicSlug ?? "",
      title: row.title,
      campaignType: row.campaignType,
      orgName: row.org.brandName || row.org.name,
      orgLogoUrl: row.org.logoUrl ?? null,
      orgPrimaryColor: (row.org as unknown as { primaryColor: string }).primaryColor,
      currency: row.currency,
      currencySymbol: currencySymbol(row.currency),
      rates: parsePlatformRates(row.ratePerThousand),
      guidelines: (row as unknown as { guidelines: string | null }).guidelines ?? null,
      requirements: (row as unknown as { requirements: string | null }).requirements ?? null,
      contentAssetsUrl:
        (row as unknown as { contentAssetsUrl: string | null }).contentAssetsUrl ?? null,
      autoApproveHours: (row as unknown as { autoApproveHours: number }).autoApproveHours,
      minPayoutMinor: (row as unknown as { minPayoutMinor: number | null }).minPayoutMinor ?? null,
      minPayoutMajor:
        (row as unknown as { minPayoutMinor: number | null }).minPayoutMinor != null
          ? minorToMajor((row as unknown as { minPayoutMinor: number }).minPayoutMinor)
          : null,
      submissionDeadline: row.submissionDeadline
        ? row.submissionDeadline.toISOString()
        : null,
      creatorCount: row._count.activations,
    },
    budget: {
      earnedMinor,
      earnedMajor: minorToMajor(earnedMinor),
      capMinor,
      capMajor: capMinor != null ? minorToMajor(capMinor) : null,
    },
    leaderboard,
  };
}

/**
 * Sum verified earnings for a campaign from the view ledger (major units) and
 * return as minor units for the budget bar. Cheap single grouped query; safe
 * to omit if the campaign has no ledger rows (returns 0).
 */
export async function earnedMinorForCampaignSlug(slug: string): Promise<number> {
  const campaign = await db.campaign.findUnique({
    where: { publicSlug: slug },
    select: { id: true },
  });
  if (!campaign) return 0;
  const agg = await db.viewLedger.aggregate({
    where: { campaignId: campaign.id },
    _sum: { amountEarned: true },
  });
  const major = agg._sum.amountEarned ?? 0;
  return majorToMinor(major);
}
