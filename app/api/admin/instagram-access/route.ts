/**
 * Read-only audit of what Instagram access this app actually holds.
 *
 * Why it runs inside prod: INSTAGRAM_CLIENT_ID, INSTAGRAM_CLIENT_SECRET and
 * INSTAGRAM_BUSINESS_TOKEN are all Vercel "sensitive" variables, which are
 * write-only -- `vercel env pull` returns them literally as [SENSITIVE]. There
 * is therefore no way to ask Graph what our own token can do from a laptop.
 * Same reasoning as app/api/admin/cc-sync and repair-dead-letters.
 *
 * Safety properties:
 *   - GET only. There is no POST/PATCH/DELETE, so it cannot mutate anything.
 *   - Inert unless IG_AUDIT_TOKEN is set: without it GET 404s, so the route
 *     does not exist as far as an unauthenticated caller can tell. Retire the
 *     audit by removing that one variable.
 *   - It never returns a token, or any prefix or suffix of one. Secrets are
 *     reported as {present, length} only. The one value it does echo is the
 *     numeric app id, which is public (it ships in every OAuth redirect URL).
 *   - Graph error bodies are returned verbatim because the error code is the
 *     diagnosis, but the access_token is passed in the query string of our own
 *     outbound request and never appears in a Graph error body.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { buildAuthorizeUrl } from "@/lib/oauth/providers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GRAPH = "https://graph.facebook.com/v26.0";

/* What Meta's own reference requires for the two Graph paths this app uses.
   business_discovery (lib/platforms/instagramBusinessDiscovery.ts) is the one
   that carries prod today; the creator-token path needs the page listing to
   resolve an IG user id at all. Sourced from
   developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery */
const REQUIRED_FOR_BUSINESS_DISCOVERY = [
  "instagram_basic",
  "instagram_manage_insights",
  "pages_read_engagement",
];
const REQUIRED_FOR_CREATOR_TOKEN_PATH = [
  "instagram_basic",
  "instagram_manage_insights",
  "pages_show_list",
];

/** Constant-time, and length-safe: timingSafeEqual throws on a length mismatch. */
function tokenMatches(presented: string | null, expected: string): boolean {
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(`Bearer ${expected}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorize(request: NextRequest) {
  const token = process.env.IG_AUDIT_TOKEN;
  if (!token) {
    return { ok: false as const, res: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  if (!tokenMatches(request.headers.get("authorization"), token)) {
    return {
      ok: false as const,
      res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { ok: true as const };
}

type Probe = { ok: boolean; status: number; body: unknown };

/** A Graph read that preserves the error instead of collapsing it to null. */
async function probe(path: string, params: Record<string, string>): Promise<Probe> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = { unparseable: true };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { fetchFailed: (err as Error).message } };
  }
}

function secretShape(value: string | undefined) {
  return { present: Boolean(value), length: value ? value.length : 0 };
}

function daysUntil(epochSeconds: number | undefined): number | null {
  if (!epochSeconds || epochSeconds <= 0) return null;
  return Math.round(((epochSeconds * 1000 - Date.now()) / 86_400_000) * 10) / 10;
}

export async function GET(request: NextRequest) {
  const auth = authorize(request);
  if (!auth.ok) return auth.res;

  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  const bizToken = process.env.INSTAGRAM_BUSINESS_TOKEN;

  const report: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    env: {
      INSTAGRAM_CLIENT_ID: secretShape(clientId),
      INSTAGRAM_CLIENT_SECRET: secretShape(clientSecret),
      INSTAGRAM_BUSINESS_TOKEN: secretShape(bizToken),
    },
    /* What our OAuth flow asks a creator for today, read off the live provider
       config rather than restated here, so this cannot drift from the code. */
    /* Read off the URL the live code would actually send a creator to, so this
       reflects any runtime scope override rather than a restated constant. */
    scopesWeRequest: (() => {
      const url = buildAuthorizeUrl("instagram", "audit");
      if (!url) return null;
      const scope = new URL(url).searchParams.get("scope");
      return scope ? scope.split(",") : null;
    })(),
    metaDocumentedRequirements: {
      businessDiscovery: REQUIRED_FOR_BUSINESS_DISCOVERY,
      creatorTokenPath: REQUIRED_FOR_CREATOR_TOKEN_PATH,
    },
  };

  // --- 1. What is the business token, and what was it granted? ---------------
  if (bizToken && clientId && clientSecret) {
    const appToken = `${clientId}|${clientSecret}`;
    const debug = await probe("debug_token", { input_token: bizToken, access_token: appToken });
    const d = (debug.body as { data?: Record<string, unknown> })?.data;
    report.businessToken = {
      probeOk: debug.ok,
      status: debug.status,
      appId: d?.app_id ?? null,
      appName: d?.application ?? null,
      type: d?.type ?? null,
      isValid: d?.is_valid ?? null,
      scopesGranted: d?.scopes ?? null,
      granularScopes: d?.granular_scopes ?? null,
      expiresAt: d?.expires_at ?? null,
      expiresInDays: daysUntil(d?.expires_at as number | undefined),
      dataAccessExpiresAt: d?.data_access_expires_at ?? null,
      dataAccessExpiresInDays: daysUntil(d?.data_access_expires_at as number | undefined),
      error: debug.ok ? null : debug.body,
    };

    const perms = await probe("me/permissions", { access_token: bizToken });
    report.mePermissions = perms.ok ? perms.body : { status: perms.status, error: perms.body };

    /* The page listing is the whole creator-token path: an IG Business account
       is reachable only through the Facebook Page it is linked to. An empty
       data array here means resolveIgUserId returns null for every token. */
    const accounts = await probe("me/accounts", {
      fields: "name,instagram_business_account{id,username}",
      access_token: bizToken,
      limit: "50",
    });
    const pages = (accounts.body as { data?: unknown[] })?.data ?? [];
    report.pages = {
      probeOk: accounts.ok,
      status: accounts.status,
      count: Array.isArray(pages) ? pages.length : 0,
      withLinkedIgAccount: Array.isArray(pages)
        ? pages.filter((p) => (p as { instagram_business_account?: unknown }).instagram_business_account).length
        : 0,
      detail: accounts.ok ? pages : accounts.body,
    };

    // --- 2. Does business_discovery actually answer? ------------------------
    const igUserId = Array.isArray(pages)
      ? (pages.find((p) => (p as { instagram_business_account?: { id?: string } }).instagram_business_account?.id) as
          | { instagram_business_account?: { id?: string } }
          | undefined)?.instagram_business_account?.id
      : undefined;

    const handle = (request.nextUrl.searchParams.get("handle") || "natgeo").replace(/^@/, "");
    if (igUserId) {
      const bd = await probe(igUserId, {
        fields: `business_discovery.username(${handle}){username,followers_count,media_count}`,
        access_token: bizToken,
      });
      report.businessDiscoveryProbe = {
        igUserId,
        handleProbed: handle,
        works: bd.ok,
        status: bd.status,
        body: bd.body,
      };
    } else {
      report.businessDiscoveryProbe = {
        igUserId: null,
        handleProbed: handle,
        works: false,
        why: "no Facebook Page with a linked instagram_business_account was returned, so there is no IG user id to query from",
      };
    }
  } else {
    report.businessToken = { skipped: "one of client id / client secret / business token is not set" };
  }

  // --- 3. What does the database say the OAuth funnel has produced? ---------
  try {
    const [igAccounts, igPosts, newestSnapshot] = await Promise.all([
      db.creatorSocialAccount.findMany({
        where: { platform: "INSTAGRAM" },
        select: { id: true, tokenExpiry: true, createdAt: true },
      }),
      db.post.count({ where: { platform: "INSTAGRAM" } }),
      db.postMetricSnapshot.findFirst({
        where: { post: { platform: "INSTAGRAM" } },
        orderBy: { recordedAt: "desc" },
        select: { recordedAt: true },
      }),
    ]);
    const now = Date.now();
    report.database = {
      instagramConnections: igAccounts.length,
      connectionsWithLiveToken: igAccounts.filter(
        (a) => !a.tokenExpiry || a.tokenExpiry.getTime() > now,
      ).length,
      connectionsExpired: igAccounts.filter(
        (a) => a.tokenExpiry && a.tokenExpiry.getTime() <= now,
      ).length,
      instagramPosts: igPosts,
      newestInstagramSnapshot: newestSnapshot?.recordedAt ?? null,
    };
  } catch (err) {
    report.database = { error: (err as Error).message };
  }

  return NextResponse.json(report, { status: 200 });
}
