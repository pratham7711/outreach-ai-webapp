import { encrypt, decrypt } from "@/lib/crypto/encrypt";
import { exchangeForLongLivedToken } from "@/lib/platforms/instagram";
import { createLogger } from "@/lib/observability/logger";

/**
 * The Instagram Business Discovery credential, kept alive without a person.
 *
 * Business Discovery is the only source of Instagram *view* counts, and its
 * credential is a Meta long-lived token: 60 days, no refresh token, and the
 * only way to extend it is to trade a still-valid one for a fresh one. It used
 * to live in INSTAGRAM_BUSINESS_TOKEN, which the application can read and
 * cannot write — so renewal was a person remembering a date sixty days out, and
 * when nobody did, Instagram views quietly stopped moving while likes and
 * comments carried on. Nothing errored. That is the failure this module exists
 * to remove.
 *
 * Three properties matter more than the mechanics:
 *
 *  1. **The env var still works.** A deployment with no row falls back to it, so
 *     this changes nothing until somebody seeds a row, and a failed seed cannot
 *     take Instagram views down.
 *  2. **An expiry is never absent.** A provider that declines to state one is
 *     recorded at its documented lifetime instead, because "no expiry" and
 *     "expires in an hour" are indistinguishable to a scheduler, and the safe
 *     reading of a silence is the short one.
 *  3. **A refresh that does not extend anything is a failure, loudly.** Meta
 *     does not promise that exchanging a long-lived token returns a later
 *     expiry. If the new date is not meaningfully further out, this says so and
 *     alerts rather than recording a success and letting the credential die on
 *     schedule with a green log behind it.
 */

export const INSTAGRAM_BUSINESS_PROVIDER = "instagram_business";

/** Start trying this far ahead of expiry. Two weeks is ~25 daily attempts
 *  before anything breaks, which is enough to survive a bad stretch at Meta
 *  and still leave a person time to intervene if every one of them fails. */
export const REFRESH_WHEN_DAYS_LEFT = 14;

/** What Meta documents for a long-lived user token, used only when a response
 *  omits expires_in. Never "forever". */
export const ASSUMED_LIFETIME_DAYS = 60;

/** A new expiry must beat the old one by at least this much to count as a
 *  refresh. Below it, the exchange returned the same window back and the
 *  credential is not actually renewable this way. */
const MIN_EXTENSION_MS = 24 * 60 * 60 * 1000;

/** In-process cache. The value changes at most once a fortnight, and without
 *  this every post read in a sync would cost a query where it used to cost an
 *  env lookup. Short enough that a rotation propagates in a minute. */
const CACHE_TTL_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

let cached: { token: string | undefined; at: number } | null = null;

/**
 * The database client, loaded at the moment it is needed.
 *
 * Not a style choice: this module is reached from
 * lib/platforms/instagramBusinessDiscovery, which is imported transitively by
 * modules that run in jsdom (and could run in a browser bundle), and a
 * top-level PrismaClient import throws there on sight. Every caller here is
 * already async, so the cost is one resolved module lookup.
 */
async function credentials() {
  const { db } = await import("@/lib/db");
  return db.platformCredential;
}

const log = createLogger({ context: { platform: "INSTAGRAM", lib: "instagramBusinessToken" } });

export function clearInstagramBusinessTokenCache(): void {
  cached = null;
}

type CredentialRow = {
  accessToken: string;
  expiresAt: Date;
  refreshedAt: Date;
  lastAttemptAt: Date | null;
  lastError: string | null;
  source: string;
};

async function readRow(): Promise<CredentialRow | null> {
  return (await credentials()).findUnique({
    where: { provider: INSTAGRAM_BUSINESS_PROVIDER },
    select: {
      accessToken: true,
      expiresAt: true,
      refreshedAt: true,
      lastAttemptAt: true,
      lastError: true,
      source: true,
    },
  });
}

/**
 * The token to call Graph with, stored value first and the env var behind it.
 *
 * An expired stored value is still returned rather than withheld. Graph answers
 * a dead token with a 190, which the health probe already reports as "token
 * expired or revoked" — the accurate diagnosis. Suppressing it here would
 * present the same situation as "not configured" and send whoever reads the
 * banner to set up a connection that already exists.
 */
export async function getInstagramBusinessToken(): Promise<string | undefined> {
  const now = Date.now();
  if (!cached || now - cached.at >= CACHE_TTL_MS) {
    let stored: string | undefined;
    try {
      const row = await readRow();
      if (row) stored = decrypt(row.accessToken, INSTAGRAM_BUSINESS_PROVIDER);
    } catch (err) {
      /* A database hiccup, or a key that cannot open the row, must not take
         Instagram metrics down when a working env var is sitting right there.
         The log is the signal; the fallback below is the behaviour. */
      log.error("stored credential unreadable; falling back to the environment", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    cached = { token: stored, at: now };
  }

  /* Only the query is cached, never the env var. Reading the environment costs
     nothing, and caching it would mean a deployment that sets or clears
     INSTAGRAM_BUSINESS_TOKEN kept serving the old answer for a minute -- which
     in a test process, where the variable moves between cases, reads as the
     accessor ignoring it entirely. */
  return cached.token ?? process.env.INSTAGRAM_BUSINESS_TOKEN ?? undefined;
}

export type CredentialStatus = {
  /** Where the token in use comes from. */
  source: "stored" | "env" | "none";
  expiresAt: string | null;
  /** Negative once it has expired. Null when there is no stored row to date. */
  daysLeft: number | null;
  refreshedAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** How the stored value got here: "manual" or "refresh". */
  storedVia: string | null;
};

export async function instagramCredentialStatus(): Promise<CredentialStatus> {
  let row: CredentialRow | null = null;
  try {
    row = await readRow();
  } catch {
    // Reported as the env case below; the read failure is already logged where
    // it matters, and a status endpoint must not throw.
  }

  if (!row) {
    return {
      source: process.env.INSTAGRAM_BUSINESS_TOKEN ? "env" : "none",
      expiresAt: null,
      daysLeft: null,
      refreshedAt: null,
      lastAttemptAt: null,
      lastError: null,
      storedVia: null,
    };
  }

  return {
    source: "stored",
    expiresAt: row.expiresAt.toISOString(),
    daysLeft: Math.floor((row.expiresAt.getTime() - Date.now()) / DAY_MS),
    refreshedAt: row.refreshedAt.toISOString(),
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    lastError: row.lastError,
    storedVia: row.source,
  };
}

/**
 * Put a value in, from an operator.
 *
 * The token handed over is exchanged for a long-lived one first, because the
 * value a person copies out of Graph Explorer is usually the short-lived hour
 * one, and storing that would schedule a refresh for six weeks after it died.
 * A token that is already long-lived survives the same exchange unchanged.
 */
/**
 * Prisma's code for "that table is not in this database" (P2021).
 *
 * It is worth naming rather than letting the raw error through, because the
 * situation is real and the raw error is useless to the person in it. Measured
 * on production 2026-09-17: PlatformCredential does not exist there -- the
 * model is in schema.prisma, the DDL was never applied -- so every read here
 * already falls back to INSTAGRAM_BUSINESS_TOKEN and nothing looks wrong. The
 * write path had no such fallback: an operator pasting a replacement token into
 * /api/platform/instagram-token got a 500 with a Prisma stack, at the exact
 * moment the credential was dead and they were trying to fix it.
 */
function missingCredentialStore(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "P2021") return true;
  const message = err instanceof Error ? err.message : String(err);
  return /PlatformCredential/i.test(message) && /does not exist|relation|undefined table/i.test(message);
}

/** What to tell whoever just tried to store a credential here. */
const NO_STORE_REASON =
  "this deployment has no credential store (the PlatformCredential table is absent), so a token cannot be saved here — set INSTAGRAM_BUSINESS_TOKEN in the project's environment variables instead, and redeploy";

export async function storeInstagramBusinessToken(
  suppliedToken: string,
): Promise<{ ok: true; expiresAt: Date; exchanged: boolean } | { ok: false; reason: string }> {
  const trimmed = suppliedToken.trim();
  if (!trimmed) return { ok: false, reason: "no token supplied" };

  const exchanged = await exchangeForLongLivedToken(trimmed).catch(() => null);
  const accessToken = exchanged?.accessToken ?? trimmed;
  const expiresAt = exchanged?.expiresAt ?? new Date(Date.now() + ASSUMED_LIFETIME_DAYS * DAY_MS);

  /* A token Meta refused to exchange is still stored: the exchange needs
     INSTAGRAM_CLIENT_ID/SECRET, and an instance that has the token but not the
     app credentials would otherwise be unable to store anything at all. It is
     recorded as unexchanged so the operator can see which happened. */
  try {
    await writeCredential({
      accessToken,
      expiresAt,
      source: "manual",
      refreshedAt: new Date(),
    });
  } catch (err) {
    if (missingCredentialStore(err)) return { ok: false, reason: NO_STORE_REASON };
    throw err;
  }
  return { ok: true, expiresAt, exchanged: exchanged !== null };
}

async function writeCredential(input: {
  accessToken: string;
  expiresAt: Date;
  source: string;
  refreshedAt: Date;
}): Promise<void> {
  const data = {
    accessToken: encrypt(input.accessToken, INSTAGRAM_BUSINESS_PROVIDER),
    expiresAt: input.expiresAt,
    refreshedAt: input.refreshedAt,
    lastAttemptAt: new Date(),
    /* cost-guard: ok — clearing the last error on a success. This is a
       diagnostic string, not a retention or expiry; expiresAt above is always
       a real date and is what stops this credential being perpetual. */
    lastError: null,
    source: input.source,
  };
  await (await credentials()).upsert({
    where: { provider: INSTAGRAM_BUSINESS_PROVIDER },
    create: { provider: INSTAGRAM_BUSINESS_PROVIDER, ...data },
    update: data,
  });
  clearInstagramBusinessTokenCache();
}

async function recordFailure(reason: string): Promise<void> {
  try {
    await (await credentials()).update({
      where: { provider: INSTAGRAM_BUSINESS_PROVIDER },
      data: { lastAttemptAt: new Date(), lastError: reason.slice(0, 500) },
    });
  } catch {
    // The row may not exist yet; the caller's outcome already says so.
  }
}

export type RefreshOutcome =
  | { status: "refreshed"; expiresAt: string; daysLeft: number; addedDays: number }
  | { status: "not-due"; expiresAt: string; daysLeft: number }
  | { status: "no-credential" }
  | { status: "not-extended"; expiresAt: string; daysLeft: number }
  | { status: "failed"; reason: string; expiresAt: string | null; daysLeft: number | null };

/**
 * One attempt to keep the credential alive.
 *
 * Seeds itself from the environment variable on first run when there is no row
 * yet, which is what makes the migration a no-op for the operator: deploy this,
 * and the first cron tick moves the existing token into a place that can renew
 * it. `force` exists for the operator who wants to know NOW whether renewal
 * works rather than in six weeks.
 */
export async function refreshInstagramBusinessToken(
  opts: { force?: boolean; now?: Date } = {},
): Promise<RefreshOutcome> {
  const now = opts.now ?? new Date();
  let row: CredentialRow | null = null;
  try {
    row = await readRow();
  } catch (err) {
    return {
      status: "failed",
      reason: `could not read the stored credential (${err instanceof Error ? err.message : String(err)})`,
      expiresAt: null,
      daysLeft: null,
    };
  }

  if (!row) {
    const seed = process.env.INSTAGRAM_BUSINESS_TOKEN;
    if (!seed) return { status: "no-credential" };
    /* Adopting the env var. Its real expiry is unknowable from here -- Meta
       will not say without the app secret and a debug_token call -- so it is
       dated conservatively at the refresh window rather than at a full
       lifetime. The next tick then tries a real exchange immediately and
       replaces this guess with a date Meta actually stated. */
    const provisional = new Date(now.getTime() + REFRESH_WHEN_DAYS_LEFT * DAY_MS);
    try {
      await writeCredential({
        accessToken: seed,
        expiresAt: provisional,
        source: "manual",
        refreshedAt: now,
      });
    } catch (err) {
      /* Same absent table as above. The daily cron runs through here, so an
         unhandled throw would fail the whole token-refresh run every night on a
         deployment that is otherwise working off the env var. */
      if (!missingCredentialStore(err)) throw err;
      return { status: "failed", reason: NO_STORE_REASON, expiresAt: null, daysLeft: null };
    }
    log.warn("adopted INSTAGRAM_BUSINESS_TOKEN into the credential store", {
      provisionalExpiry: provisional.toISOString(),
    });
    row = {
      accessToken: encrypt(seed, INSTAGRAM_BUSINESS_PROVIDER),
      expiresAt: provisional,
      refreshedAt: now,
      lastAttemptAt: now,
      lastError: null,
      source: "manual",
    };
  }

  const daysLeft = Math.floor((row.expiresAt.getTime() - now.getTime()) / DAY_MS);
  if (!opts.force && daysLeft > REFRESH_WHEN_DAYS_LEFT) {
    return { status: "not-due", expiresAt: row.expiresAt.toISOString(), daysLeft };
  }

  let current: string;
  try {
    current = decrypt(row.accessToken, INSTAGRAM_BUSINESS_PROVIDER);
  } catch (err) {
    const reason = `stored credential could not be decrypted (${err instanceof Error ? err.message : String(err)})`;
    await recordFailure(reason);
    return { status: "failed", reason, expiresAt: row.expiresAt.toISOString(), daysLeft };
  }

  const fresh = await exchangeForLongLivedToken(current).catch(() => null);
  if (!fresh) {
    const reason = "Meta refused the exchange (the token may already be dead, or the app credentials are missing)";
    await recordFailure(reason);
    return { status: "failed", reason, expiresAt: row.expiresAt.toISOString(), daysLeft };
  }

  const newExpiry = fresh.expiresAt ?? new Date(now.getTime() + ASSUMED_LIFETIME_DAYS * DAY_MS);

  /* The check that makes this trustworthy. Meta returning a token is not the
     same as Meta extending one, and a refresher that assumes it is would report
     success every day for a fortnight and then go dark. */
  if (newExpiry.getTime() - row.expiresAt.getTime() < MIN_EXTENSION_MS) {
    const reason = `the exchange returned a token expiring ${newExpiry.toISOString()}, no later than the one held; this credential cannot be renewed automatically`;
    /* Stored anyway: it is a working token either way, and refusing to keep it
       would throw away the only valid credential we have. */
    await writeCredential({ accessToken: fresh.accessToken, expiresAt: newExpiry, source: "refresh", refreshedAt: now });
    await recordFailure(reason);
    return {
      status: "not-extended",
      expiresAt: newExpiry.toISOString(),
      daysLeft: Math.floor((newExpiry.getTime() - now.getTime()) / DAY_MS),
    };
  }

  await writeCredential({
    accessToken: fresh.accessToken,
    expiresAt: newExpiry,
    source: "refresh",
    refreshedAt: now,
  });

  return {
    status: "refreshed",
    expiresAt: newExpiry.toISOString(),
    daysLeft: Math.floor((newExpiry.getTime() - now.getTime()) / DAY_MS),
    addedDays: Math.floor((newExpiry.getTime() - row.expiresAt.getTime()) / DAY_MS),
  };
}
