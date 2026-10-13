/**
 * @jest-environment node
 *
 * Ratchet: every route handler under app/api that can change something (POST,
 * PUT, PATCH, DELETE) checks a role permission, or is on the list below with
 * the reason it does not need one.
 *
 * Why this exists: the role table in lib/rbac.ts was enforced only where a route
 * remembered to ask. Payout status, deposit release, campaign edits, adding
 * posts, share links, creator edits, lists, media kits and more had a session
 * check and nothing else, so a VIEWER -- and read-only act-as, which maps to
 * VIEWER -- could do all of it. Each was fixed by hand; this keeps the next
 * route from shipping the same way. A new mutating handler fails here until it
 * calls requirePermission / permissionDenial / hasPermission, or is added to the
 * allowlist with a one-line reason a reviewer can disagree with.
 *
 * The check is textual, per handler: the handler's own body, or a function in
 * the same file that the handler calls, must call one of the helpers. It
 * cannot tell whether the permission chosen is the right one -- that is review
 * -- only that one was chosen at all.
 */
import fs from "fs";
import path from "path";

const API_ROOT = path.join(process.cwd(), "app", "api");
const MUTATING = ["POST", "PUT", "PATCH", "DELETE"] as const;
const PERMISSION_CALL = /\b(requirePermission|permissionDenial|hasPermission)\s*\(/;

type Rule = { reason: string; mustCall: RegExp };

/* Whole trees that are not org-role territory. Each still has to call its own
   gate, so a route added under one of them without that gate fails too. */
const PREFIX_RULES: Record<string, Rule> = {
  "admin/": {
    reason: "operator maintenance endpoints, called with the ADMIN/CRON bearer secret, never by an org session",
    mustCall: /\bbearerMatches\s*\(/,
  },
  "cron/": {
    reason: "scheduled jobs, authenticated by CRON_SECRET",
    mustCall: /\b(bearerMatches|cronRoute|runPostSweep)\s*\(/,
  },
  "platform/": {
    reason: "the platform operator console, gated on the platform-admin allowlist rather than an org role",
    mustCall: /\b(isPlatformAdmin|requirePlatformAdmin|operatorEmail)\s*\(/,
  },
  "portal/": {
    reason: "the creator portal: creators are not org members and hold no org role",
    mustCall: /\bgetCreatorSession\s*\(/,
  },
  "webhooks/": {
    reason: "platform callbacks, authenticated by the platform's signature",
    mustCall: /\bverify\w*(Signature|SignedRequest)\s*\(/,
  },
};

type Entry = { reason: string; methods?: readonly string[]; mustCall?: RegExp };

/* Single routes. Paths are relative to app/api. An entry wins over a prefix
   rule, so the portal's own sign-in routes can be listed under "portal/". */
const ALLOWLIST: Record<string, Entry> = {
  "auth/[...nextauth]/route.ts": { reason: "NextAuth's own sign-in and sign-out handlers" },
  "auth/forgot-password/route.ts": { reason: "nobody is signed in yet; rate limited, answers alike for every address" },
  "auth/reset-password/route.ts": { reason: "the emailed reset token is the credential" },
  "auth/verify-email/route.ts": { reason: "the emailed verification token is the credential" },
  "auth/resend-verification/route.ts": { reason: "re-sends the caller's own verification mail; rate limited, touches no org data" },
  "signup/route.ts": { reason: "creates the account and its org; there is no role before it exists" },
  "invites/accept/route.ts": { reason: "the team invite token is the credential; the joiner has no role until it is accepted" },
  "campaign-invites/respond/route.ts": { reason: "public creator invite response; the invite token is the credential, rate limited" },
  "l/[token]/decision/route.ts": { reason: "the client's approval link; the list share token is the credential" },
  "feedback/route.ts": { reason: "product feedback from any signed-in seat or share-link viewer, written only to the operator inbox" },
  "settings/notifications/route.ts": { reason: "the caller's own notification preferences, keyed to their user id" },
  "trackers/creators/ingest/route.ts": {
    reason: "the tracker worker's ingest; bearer token, no user session",
    mustCall: /\bbearerMatches\s*\(/,
  },
  "trackers/sounds/ingest/route.ts": {
    reason: "the sound tracker worker's ingest; bearer token, no user session",
    mustCall: /\bbearerMatches\s*\(/,
  },
  "trackers/source-health/route.ts": {
    reason: "the tracker worker's health report; bearer token, no user session",
    mustCall: /\bbearerMatches\s*\(/,
  },
  "mcp/route.ts": { reason: "DELETE is a 405 stub; there is no MCP session to end", methods: ["DELETE"] },
  "portal/auth/login/route.ts": { reason: "creator sign-in; nobody is signed in yet" },
  "portal/auth/register/route.ts": { reason: "creator registration; nobody is signed in yet" },
  "portal/auth/logout/route.ts": { reason: "clears the caller's own portal cookie" },
};

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(full, out);
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

type Chunk = { name: string | null; text: string };

/** The file cut at every top-level declaration, so each function's text is its own. */
function chunks(src: string): Chunk[] {
  const lines = src.split("\n");
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (/^(export\s+)?(default\s+)?(async\s+)?(function|const|let|class)\b/.test(line)) starts.push(i);
  });
  return starts.map((start, k) => {
    const text = lines.slice(start, k + 1 < starts.length ? starts[k + 1] : lines.length).join("\n");
    const m = text.match(/^(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+(\w+)/);
    return { name: m ? m[1] : null, text };
  });
}

const calls = (name: string) => new RegExp(`\\b${name}\\s*\\(`);

/** Names of the functions in this file that reach `gate`, directly or through another local function. */
function reachingGate(cs: Chunk[], gate: RegExp): Set<string> {
  const reach = new Set(cs.filter((c) => c.name && gate.test(c.text)).map((c) => c.name as string));
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cs) {
      if (!c.name || reach.has(c.name)) continue;
      if ([...reach].some((g) => calls(g).test(c.text))) {
        reach.add(c.name);
        grew = true;
      }
    }
  }
  return reach;
}

type Handler = { file: string; method: string; text: string; cs: Chunk[] };

function mutatingHandlers(): Handler[] {
  const out: Handler[] = [];
  for (const full of routeFiles(API_ROOT)) {
    const file = path.relative(API_ROOT, full).split(path.sep).join("/");
    const src = fs.readFileSync(full, "utf8");
    const cs = chunks(src);
    for (const c of cs) {
      const m = c.text.match(/^export\s+(?:async\s+)?(?:function|const)\s+(POST|PUT|PATCH|DELETE)\b/);
      if (m) out.push({ file, method: m[1], text: c.text, cs });
    }
    /* `export const { GET, POST } = handlers` and `export { POST } from ...`
       cannot be read per handler; they are recorded with no body, so only an
       allowlist entry lets them through. */
    for (const m of src.matchAll(/^export\s+(?:const\s+)?\{([^}]*)\}/gm)) {
      for (const name of m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!)) {
        if ((MUTATING as readonly string[]).includes(name)) out.push({ file, method: name, text: "", cs });
      }
    }
  }
  return out;
}

function guardedBy(h: Handler, gate: RegExp): boolean {
  if (gate.test(h.text)) return true;
  const reach = reachingGate(h.cs, gate);
  return [...reach].some((name) => name !== h.method && calls(name).test(h.text));
}

function prefixRule(file: string): [string, Rule] | null {
  const hit = Object.entries(PREFIX_RULES).find(([prefix]) => file.startsWith(prefix));
  return hit ?? null;
}

function allowEntry(h: Handler): Entry | null {
  const entry = ALLOWLIST[h.file];
  if (!entry) return null;
  if (entry.methods && !entry.methods.includes(h.method)) return null;
  return entry;
}

const handlers = mutatingHandlers();

describe("every mutating API route checks a permission", () => {
  it("finds the route handlers it is meant to police", () => {
    /* A refactor that moved or renamed the routes would otherwise turn this
       into a test that passes by checking nothing. */
    expect(handlers.length).toBeGreaterThan(150);
    expect(handlers.some((h) => h.file === "payouts/[id]/route.ts" && h.method === "PATCH")).toBe(true);
  });

  it("has a permission check, or an allowlist entry with a reason, on every POST/PUT/PATCH/DELETE", () => {
    const unguarded: string[] = [];
    for (const h of handlers) {
      if (allowEntry(h)) continue;
      if (prefixRule(h.file)) continue;
      if (h.text && guardedBy(h, PERMISSION_CALL)) continue;
      unguarded.push(`${h.method} app/api/${h.file}`);
    }
    expect(unguarded).toEqual([]);
  });

  it("holds each allowlisted or prefix-ruled route to the gate it claims", () => {
    const missing: string[] = [];
    for (const h of handlers) {
      const entry = allowEntry(h);
      const rule = entry ? (entry.mustCall ? { mustCall: entry.mustCall } : null) : prefixRule(h.file)?.[1];
      if (!rule) continue;
      if (h.text && guardedBy(h, PERMISSION_CALL)) continue;
      if (!h.text || !guardedBy(h, rule.mustCall)) {
        missing.push(`${h.method} app/api/${h.file} (expected ${rule.mustCall})`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    /* An entry for a route that no longer exists, or that now checks a
       permission itself, is an exemption waiting to cover something new. */
    const stale: string[] = [];
    for (const [file, entry] of Object.entries(ALLOWLIST)) {
      const listed = handlers.filter(
        (h) => h.file === file && (!entry.methods || entry.methods.includes(h.method))
      );
      if (listed.length === 0) {
        stale.push(`${file}: no ${entry.methods?.join("/") ?? "mutating"} handler`);
        continue;
      }
      if (listed.every((h) => h.text && guardedBy(h, PERMISSION_CALL))) {
        stale.push(`${file}: every listed handler now checks a permission`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("gives every exemption a reason", () => {
    for (const [, rule] of Object.entries(PREFIX_RULES)) expect(rule.reason.length).toBeGreaterThan(10);
    for (const [, entry] of Object.entries(ALLOWLIST)) expect(entry.reason.length).toBeGreaterThan(10);
  });
});
