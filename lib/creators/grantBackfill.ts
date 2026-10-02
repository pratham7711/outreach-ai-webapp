import { db } from "@/lib/db";
import type { Platform } from "@/lib/generated/prisma/client";
import { decrypt } from "@/lib/crypto/encrypt";
import { ACCOUNT_ORIGINS } from "@/lib/platforms/accountOrigin";
import { grantTablesReady } from "@/lib/creators/grantTables";
import { GRANT_SOURCES } from "@/lib/creators/grants";
import { grantKey } from "@/lib/creators/connectionGate";

/**
 * Grants for the connections made before grants were kept (plan K4).
 *
 * The gate refuses a connection with no live grant, so on the day the table
 * appears every existing connection would go dark unless it is granted first.
 * This records one grant per real connection, for the org the connection was
 * made under — the org of the roster row it hangs off, which is also the org
 * its token is sealed with — and nothing for a row that never had a consent
 * behind it.
 *
 * Reports in counts only. Nothing here returns or logs a handle, a token, or
 * a connection id.
 */

export const BACKFILL_SKIPS = {
  /** origin "manual", or a NULL-origin row whose token is the "manual-entry"
   *  placeholder: an agency typed it in, nobody consented to anything. */
  MANUAL: "manual",
  /** The non-production connect shortcut. */
  DEV: "dev",
  /** A NULL-origin row whose token does not open under its own org. It cannot
   *  be read by anyone, so granting it would change nothing but the record. */
  UNREADABLE: "unreadable",
  /** A NULL-origin row with a real-looking token but no platform account id.
   *  The OAuth callback has refused to store a row without one since identity
   *  became the key, and the agency's own form never sets one, so this is far
   *  more likely a token an agency pasted than a consent. Counted, not granted;
   *  the dry run shows how many there are before anything is applied. */
  NO_IDENTITY: "no_identity",
} as const;
export type BackfillSkip = (typeof BACKFILL_SKIPS)[keyof typeof BACKFILL_SKIPS];

export type BackfillConnection = {
  id: string;
  creatorId: string;
  platform: Platform;
  platformUserId: string | null;
  origin: string | null;
  accessToken: string;
  createdAt: Date;
  orgId: string;
};

/** Whether a connection gets a backfilled grant, or why not. Pure. */
export function classifyForBackfill(row: BackfillConnection): "grant" | BackfillSkip {
  if (row.origin === ACCOUNT_ORIGINS.OAUTH || row.origin === ACCOUNT_ORIGINS.OAUTH_INSTAGRAM_LOGIN) {
    return "grant";
  }
  if (row.origin === ACCOUNT_ORIGINS.MANUAL) return BACKFILL_SKIPS.MANUAL;
  if (row.origin === ACCOUNT_ORIGINS.DEV) return BACKFILL_SKIPS.DEV;

  /* NULL (or an origin this code does not know): the rows from before origin
     was recorded. The token is the only witness to what the row is, so it is
     opened here, compared, and dropped — never returned. */
  let token: string;
  try {
    token = decrypt(row.accessToken, row.orgId);
  } catch {
    return BACKFILL_SKIPS.UNREADABLE;
  }
  if (token === "manual-entry") return BACKFILL_SKIPS.MANUAL;
  if (token.startsWith("dev-token-")) return BACKFILL_SKIPS.DEV;
  if (!row.platformUserId) return BACKFILL_SKIPS.NO_IDENTITY;
  return "grant";
}

export type BackfillCount = {
  orgId: string;
  platform: Platform;
  /** Grants a POST would write. */
  wouldCreate: number;
  /** Connections that already hold a live grant in their org. */
  existing: number;
  skipped: Partial<Record<BackfillSkip, number>>;
};

export type BackfillGrantRow = {
  orgId: string;
  creatorId: string;
  platform: Platform;
  connectionId: string;
  platformAccountId: string | null;
  scopes: string[];
  scopesSource: null;
  grantedAt: Date;
  source: typeof GRANT_SOURCES.BACKFILL;
};

export type BackfillPlan = {
  /** Kept server-side; the routes return `counts` and `totals` only. */
  rows: BackfillGrantRow[];
  counts: BackfillCount[];
  totals: { connections: number; wouldCreate: number; existing: number; skipped: number };
};

/**
 * The plan, from rows already loaded. Pure, so the classification and the
 * per-org counts are tested without a database.
 *
 * `granted` holds grantKey(org, connection) for every live grant on record, so
 * a connection counts as granted only IN ITS OWN ORG; a grant some other org holds does not count, because the gate would not
 * honour it for this one.
 */
export function planBackfill(connections: BackfillConnection[], granted: Set<string>): BackfillPlan {
  const rows: BackfillGrantRow[] = [];
  const byKey = new Map<string, BackfillCount>();
  let existing = 0;
  let skipped = 0;

  for (const c of connections) {
    const key = `${c.orgId}\u0000${c.platform}`;
    const count = byKey.get(key) ?? { orgId: c.orgId, platform: c.platform, wouldCreate: 0, existing: 0, skipped: {} };
    byKey.set(key, count);

    if (granted.has(grantKey(c.orgId, c.id))) {
      count.existing++;
      existing++;
      continue;
    }
    const verdict = classifyForBackfill(c);
    if (verdict !== "grant") {
      count.skipped[verdict] = (count.skipped[verdict] ?? 0) + 1;
      skipped++;
      continue;
    }
    count.wouldCreate++;
    rows.push({
      orgId: c.orgId,
      creatorId: c.creatorId,
      platform: c.platform,
      connectionId: c.id,
      platformAccountId: c.platformUserId,
      /* Unknown, and said so: what the consent granted was never recorded, and
         the scopes the app asks for today are not what it asked for then. */
      scopes: [],
      scopesSource: null,
      /* The connection's own age, so "granted" on the Access panel is when the
         creator actually connected rather than the day this ran. */
      grantedAt: c.createdAt,
      source: GRANT_SOURCES.BACKFILL,
    });
  }

  const counts = [...byKey.values()].sort(
    (a, b) => a.orgId.localeCompare(b.orgId) || a.platform.localeCompare(b.platform),
  );
  return {
    rows,
    counts,
    totals: { connections: connections.length, wouldCreate: rows.length, existing, skipped },
  };
}

/**
 * Loads every connection and the live grants already on record, and plans.
 *
 * `tableExists` false means the grant table has not been created yet (the
 * migrate route plans before it creates), so there is nothing to look up and
 * every connection is a candidate.
 */
export async function loadBackfillPlan(tableExists: boolean): Promise<BackfillPlan> {
  const accounts = await db.creatorSocialAccount.findMany({
    select: {
      id: true,
      creatorId: true,
      platform: true,
      platformUserId: true,
      origin: true,
      accessToken: true,
      createdAt: true,
      creator: { select: { orgId: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const connections: BackfillConnection[] = accounts.map(({ creator, ...a }) => ({ ...a, orgId: creator.orgId }));

  const granted = new Set<string>();
  if (tableExists && connections.length > 0) {
    const live = await db.creatorGrant.findMany({
      where: { revokedAt: null, connectionId: { in: connections.map((c) => c.id) } },
      select: { orgId: true, connectionId: true },
    });
    for (const g of live) if (g.connectionId) granted.add(grantKey(g.orgId, g.connectionId));
  }
  return planBackfill(connections, granted);
}

/** What the backfill routes answer with: the plan without its rows. */
export function publicPlan(plan: BackfillPlan) {
  return { totals: plan.totals, counts: plan.counts };
}

/**
 * Writes the planned grants. Requires the table; returns how many were
 * written. skipDuplicates is ON CONFLICT DO NOTHING, which the partial unique
 * index on live (orgId, connectionId) turns into "a connection granted since
 * the plan was made keeps the grant it has".
 */
export async function applyBackfill(): Promise<{ plan: BackfillPlan; created: number } | null> {
  if (!(await grantTablesReady({ fresh: true }))) return null;
  const plan = await loadBackfillPlan(true);
  if (plan.rows.length === 0) return { plan, created: 0 };
  const { count } = await db.creatorGrant.createMany({ data: plan.rows, skipDuplicates: true });
  return { plan, created: count };
}
