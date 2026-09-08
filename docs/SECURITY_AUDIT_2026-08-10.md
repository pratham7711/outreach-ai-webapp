# Security Audit — Made Boring Campaigns webapp

**Date:** 2026-08-10
**Target:** local dev build (`localhost:3009`) + dependency tree + source review
**Method:** live probing of the running app (auth, IDOR, privilege separation, rate-limit, redirect, headers), `npm audit`, and source review of the hot paths.

> **On Strix specifically:** I could not run `usestrix/strix` here. It hard-requires **Docker running** (Docker is not installed on this machine) and it ships your **source code to a third-party LLM** (OpenAI/Anthropic/etc.) with a key you'd supply — a spend + data-egress decision that's yours to make, not mine to trigger unasked. So I ran an equivalent manual pass covering the same OWASP surface Strix targets. If you want the actual Strix run, install Docker Desktop and I'll wire it up against the preview URL (details at the end).

---

## Verdict

**Not a launch blocker, but three things should be fixed before real creators/brands are on it.** Core tenant isolation and auth enforcement are solid — the multi-tenant `orgId` discipline held everywhere I probed. The gaps are (1) a stale dependency tree with 3 critical CVEs, one in your auth library, (2) a rate-limiter that a trivial header trick defeats, and (3) no security response headers at all.

| # | Severity | Finding | Fix effort |
|---|----------|---------|-----------|
| F1 | **High** | `next-auth`/`@auth/core` on versions with 3 critical CVEs (auth bypass class) | dependency bump |
| F2 | **High** | Login/join rate-limit bypassable by rotating `X-Forwarded-For` | ~5 lines |
| F3 | Medium | No security headers (CSP, HSTS, X-Frame-Options, nosniff…) | ~15 lines |
| F4 | Medium | `next@16.2.10` has 4 High CVEs incl. middleware bypass + SSRF | one bump |
| F5 | Low | Rate-limit state is in-memory → resets per serverless instance/cold start | design |
| F6 | Low | Register endpoint enables user enumeration + accepts weak passwords | ~5 lines |
| F7 | Low | 40 total `npm audit` advisories in transitive deps (xlsx, sharp, lodash…) | triage |

---

## What's solid (verified live, not assumed)

These were actively probed and **passed** — worth stating so the report isn't just a problem list:

- **Auth enforcement.** Every privileged API (`/api/campaigns`, `/creators`, `/clients`, `/payouts`, `/audit-logs`, `/dashboard/financials`, `/analytics`, `/discovery`) returns **401 unauthenticated**. No exposed route found across 124 API endpoints.
- **Privilege separation.** A logged-in **creator-portal** session was pointed at every brand-side API — all **401**. The two auth domains (NextAuth brand users vs. `creator_portal_token` creators) don't cross.
- **Cron auth.** `/api/cron/sync-posts` and `/api/cron/auto-approve-submissions` both require `CRON_SECRET` — **401** without it.
- **Open redirect.** `returnTo=https://evil.com`, `//evil.com`, and `/dashboard` are all rejected by `safeReturnTo()` — only same-site `/portal/*` paths echo back. (This was the boundary I hardened earlier; it holds.)
- **No SQL/prompt-injection in the AI query path.** `/api/ai/nl-query` uses the LLM **only to classify into a fixed intent enum**; every branch is a typed Prisma query scoped by `orgId`. User text never reaches raw SQL. This is the right pattern.
- **Login rate-limit exists** (10 / 60s) and fires — it's just keyed on a spoofable header (F2).
- **Passwords** hashed with bcrypt (cost 10). Session cookie is `HttpOnly`, `SameSite=lax`, `Secure`.

---

## Findings

### F1 — Auth library on versions with critical CVEs *(High)*

Installed: `next-auth@5.0.0-beta.30`, `@auth/core@0.41.0/0.41.1`. `npm audit` flags all three as vulnerable:

- **CRITICAL** `@auth/core <0.41.3` — email normalizer validates *before* Unicode normalization → **homoglyph `@` bypass** (`GHSA-7rqj-j65f-68wh`)
- **CRITICAL** `next-auth 5.0.0-beta.0..31` — config errors can make existence-based auth checks **fail open** (`GHSA-8fpg-xm3f-6cx3`)
- **HIGH** `@auth/core` — `getToken()` throws uncaught on malformed Bearer header (`GHSA-xmf8-cvqr-rfgj`)

This is your actual login/session layer (`proxy.ts` → `NextAuth(authConfig).auth`), which is why it's top of the list even though exploitation needs specific conditions.

**Fix:** `npm i next-auth@latest @auth/core@latest`, then re-run the auth flow live (login, session, logout) — beta→beta bumps occasionally change config shape.

### F2 — Rate limit bypassable via `X-Forwarded-For` rotation *(High)*

`lib/request.ts` takes `x-forwarded-for.split(",")[0]` as the client IP, and `lib/rateLimit.ts` keys the bucket on it. **Proven live:**

```
IP=1.1.1.1 exhausted → 429
rotate to X-Forwarded-For: 2.2.2.2 → 401 (fresh budget)
```

An attacker sets a new `X-Forwarded-For` per request and gets unlimited login/join/reset attempts — the throttle is effectively off for credential stuffing. On Vercel the trustworthy client IP is the **last** XFF hop (or `x-real-ip`, which Vercel sets), not the leftmost (client-controlled).

**Fix:** in `getRequestIp`, prefer `x-real-ip`; if using XFF, take the **last** entry, not the first. ~5 lines.

### F3 — No security response headers *(Medium)*

`next.config.ts` is empty and `proxy.ts` sets none. All missing on app responses: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. No CSP → any XSS that slips in runs unconstrained; no `X-Frame-Options` → clickjacking on the portal.

**Fix:** add a `headers()` block in `next.config.ts` (HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a starter CSP). ~15 lines. Vercel serves HSTS on `*.vercel.app` already, but your custom domain needs it explicit.

### F4 — `next@16.2.10` has 4 High CVEs *(Medium)*

Includes **middleware/proxy bypass** in App Router (`GHSA-6gpp-xcg3-4w24`), **SSRF in Server Actions on custom servers** (`GHSA-89xv-2m56-2m9x`), **SSRF in rewrites** (`GHSA-p9j2-gv94-2wf4`), and a Server Actions DoS. Fixed in `16.2.11`.

**Fix:** `npm i next@16.2.11` (patch bump, low risk). Re-run `npm run build`.

### F5 — In-memory rate limiter doesn't survive serverless *(Low)*

`buckets` is a module-level `Map`. On Vercel each function instance has its own memory and cold-starts wipe it, so the limit is per-instance, not global — compounding F2. Fine for a pilot; before scale, move to Upstash/Redis or Vercel KV. (Flagging, not fixing — it's a design/infra call.)

### F6 — User enumeration + weak passwords on register *(Low)*

`/api/auth/register` returns `"Email already in use"` (400) → lets anyone enumerate registered brand emails. And it only checks `!password` — **no minimum length/complexity**, so `"a"` is accepted. *(The route no longer exists — deleted 2026-09-08; `/api/signup` is the only signup door.)*

**Fix:** generic success/"check your email" response regardless of existence; add a `z.string().min(10)` (or similar) password rule. The creator-portal register already validates more strictly — mirror that.

### F7 — 40 transitive-dependency advisories *(Low, triage)*

`npm audit`: **3 critical / 24 high / 9 moderate / 4 low**. Beyond the auth/next ones above, notable transitive: `xlsx` (prototype pollution + ReDoS, **no fixed version published** — used in your CSV/export paths, worth isolating), `sharp<0.35` (libvips CVEs), `lodash _.template` code injection, `form-data` CRLF injection. Most resolve via `npm audit fix`; `xlsx` needs a manual look since there's no upstream fix.

---

## Suggested order

1. `npm i next@16.2.11 next-auth@latest @auth/core@latest` → `npm run build` → drive login/session live *(clears F1, F4)*
2. Fix `getRequestIp` to use a trustworthy IP source *(F2, ~5 lines)*
3. Add the `headers()` block *(F3, ~15 lines)*
4. `npm audit fix`, then manually triage `xlsx` *(F7)*
5. Harden register response + password rule *(F6)*
6. Backlog: durable rate-limit store before scale *(F5)*

Items 1–3 are the ones I'd want done before real brands/creators touch it. None block the TikTok review (that's about the connect flow, which is clean).

---

## Remediation — 2026-08-12 (pre-madeboring.com launch)

Applied during the `campaign.madeboring.com` deploy prep. All verified locally against the built app (`next start`, dev Neon branch).

| # | Status | What changed | Verification |
|---|--------|--------------|--------------|
| F1 | **Fixed** | `next-auth 5.0.0-beta.30 → 5.0.0-beta.32`; `@auth/core → 0.41.3` pinned everywhere via `overrides` (also deduped the `@auth/prisma-adapter` copy that was stuck on 0.41.1). **Note:** `next-auth@latest` resolves to v4.24.15 — using it would have downgraded off v5 and broken auth; pinned the beta explicitly instead. | `npm audit`: next-auth + @auth/core **clean**. Live login drives end-to-end: `/api/auth/callback/credentials` → 302, `/api/auth/session` returns user+orgId+role. |
| F2 | **Fixed** | `getRequestIp` now prefers `x-real-ip` (Vercel-set, client can't spoof), else the **last** `x-forwarded-for` hop — not the client-controlled leftmost. | tsc + build clean; unit suite green. |
| F3 | **Fixed** | `next.config.ts` `headers()` block: HSTS (2y, preload), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. Skipped a content-CSP for pilot (app is inline-`style`-heavy — a strict CSP needs live testing; tracked as follow-up). | All five headers confirmed present at runtime on `/login`. |
| F4 | **Fixed** | `next 16.2.10 → 16.2.11` (middleware bypass + SSRF CVEs). Chose the patch, not the 16.3.0 minor. | Build + `next start` on 16.2.11. |
| F6 | **Fixed (route deleted 2026-09-08)** | `/api/auth/register` was a duplicate of `/api/signup` with weaker validation and no callers anywhere in the repo, so it was removed rather than hardened further. The enumeration message and the `< 10` password rule went with it. | grep for callers came back empty; tsc clean. |
| F5 | **Deferred** | In-memory rate-limit — post-pilot infra call (Upstash/Vercel KV). Unchanged. | — |
| F7 | **Deferred** | Residual transitive advisories (`next`-high via deps, `handlebars` critical via build tooling, `xlsx`) — not in a runtime auth/tenant path. Post-pilot triage. | — |

Net: 990 unit tests pass, `tsc --noEmit` clean, `npm run build` exit 0, login verified live on the hardened build.

---

## F8 — RBAC enforcement gap (surfaced by the PRD teardown, 2026-08-12)

**Severity: High.** The 5-role RBAC model (`lib/rbac.ts`) was fully defined but only **2 of 82** write endpoints actually enforced it — every other authenticated org member (including `VIEWER`) could write via any un-gated route. Fixed incrementally behind a shared guard.

**Fix — the guard primitive.** New `lib/authz.ts::requirePermission(request, permission)`: authenticates, then checks `hasPermission(role, permission)`; returns a discriminated `{ok:true, auth}` / `{ok:false, response}` union so callers can't forget the deny branch. `AuthResult` now carries `role` (`lib/authenticate.ts`). Applied to `campaigns` POST/PATCH/DELETE and `payouts` POST.

**Adversarial review (opus) caught two issues — both fixed the same day:**

| # | Severity | Issue | Fix | Verification |
|---|----------|-------|-----|--------------|
| R1 | **Blocker** | `requirePermission` blanket-allows `actorType==="api_key"`, but `POST /api/keys` was gated only by *authentication*, not role. A VIEWER could mint an `oai_` key, then use it as a Bearer token to bypass every RBAC gate — including `payments:manage`. Security theater against a motivated member. | Gated the whole `/api/keys` resource (GET+POST) with `settings:manage` → **OWNER/ADMIN only**. Minting is now privileged, so the escalation path is closed. | **Unit** + **integration** green: `settings:manage` denied for MANAGER/MEMBER/VIEWER; integration test drives a real VIEWER session → `POST /api/keys` **403**, `apiKey.create` never called. **Live sandbox, end-to-end:** a real VIEWER session (role set in-DB via Neon HTTPS) got **403 on `POST /api/keys` AND `POST /api/campaigns`** — the exact mint→bypass two-step is closed. OWNER mint → 201 (no admin lockout). |
| R2 | Should-fix | Gating PATCH on the non-existent string `campaigns:edit` blocked MEMBER from editing **even their own** campaigns (regression); the map's intent is `campaigns:edit_own`. But the handler had **no ownership check**, so naively switching to `edit_own` would have become edit-*any*. | Gate on `campaigns:edit_own` + added an ownership guard: MANAGER+/api-key edit any; MEMBER restricted to `createdById === userId`. Closes both the regression and the latent edit-any hole. | **Unit** + **integration** green: new integration tests drive real sessions — MEMBER edits own → **200**, MEMBER edits another's → **403** (no write), VIEWER edits any → **403**. |

**Deferred (flagged in review, not in this diff):**
- **Stale JWT role (up to 30 days).** `role` is baked into the NextAuth JWT at login and only refreshed on re-login; `session.maxAge` is unset (defaults to 30d). A demoted/offboarded user keeps their old write permissions until the token expires. Latent pre-fix, now security-relevant. **Recommendation:** shorten `maxAge` or re-read role from DB in the guard (adds one query per gated write). *Product/UX call — parked.*
- **Guard ignores per-user permission overrides.** `hasPermission` doesn't pass the `PermissionOverrideMap`; a future **deny**-override would be silently ignored. No override data exists yet (consistent with the two pre-existing RBAC routes), so no live impact — track before wiring overrides.
- **Remaining ~62 write routes** still un-gated (task #38). Sweep with the proven pattern; excludes portal/cron/public/webhook/auth/mcp/connections surfaces. Full mapping spec: `docs/RBAC_SWEEP_MAP_2026-08-12.md`.

---

## F9 — Two more un-gated writes found during the sweep mapping (2026-08-12)

The permission-mapping pass (sonnet agent over all 62 write handlers) surfaced two routes that were authenticated but had **no role check at all** — same class as F8's blocker. Both fixed + CI-pinned the same day.

| # | Severity | Route | Hole | Fix | Test |
|---|----------|-------|------|-----|------|
| F9.1 | **High** | `reports` POST + `reports/[id]` PATCH | Only a feature-entitlement check, no RBAC. Any VIEWER could **create a report** or flip an existing report's **`isPublic: true`** to expose campaign data on the public share URL. The sibling DELETE in the same file already enforced `reports:*`. | Added the identical inline `hasPermission(role, "reports:*")` guard (OWNER/ADMIN/MANAGER) to POST + PATCH. | integration: VIEWER create → 403 (no `create`); VIEWER `isPublic` flip → 403 (no `update`); OWNER flip → 200. |
| F9.2 | Medium | `fraud-flags/[id]` PATCH | Session-authed but no role check, **org-wide** (no campaign scope). Any VIEWER could resolve/suppress any fraud flag. | Gated with `requirePermission(request, "campaigns:edit")` → MANAGER+ (blocks VIEWER/MEMBER). **Conservative default** — proper per-campaign scoping is a follow-up (route has no campaign join). | integration: VIEWER resolve → 403 (no `update`); OWNER resolve → 200. |

Still open from the same pass (documented in the sweep map, not yet actioned): `creators:edit_own` is unenforceable (no `Creator.createdById`), and a negotiation-accept path duplicates `negotiations/approve` without its audit/finalRate logic.

---

## Running the real Strix later

When Docker Desktop is installed:

```bash
export STRIX_LLM="anthropic/claude-..."   # or openai/...
export LLM_API_KEY="<key>"                 # gitignored env only — never in chat
curl -sSL https://strix.ai/install | bash
strix -n --target http://localhost:3009    # or the Vercel preview URL
# results land in ./strix_runs/<run-name>
```

Two cautions: it **sends code/traffic to the configured LLM provider** (data egress + spend), and point it at the **preview or a throwaway DB**, never prod — it actively sends exploit payloads and can mutate data.
