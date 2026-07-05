# Deployment Notes — Rate Limiting & Request-Scoped Logging (P4.2)

## Rate Limiting

`lib/rateLimit.ts` provides a zero-dependency, **in-process sliding-window** limiter:

```ts
rateLimit({ key, limit, windowMs }) => { allowed, remaining, retryAfterSeconds }
```

- Each key holds an array of request timestamps. On every call, timestamps older
  than `now - windowMs` are pruned, then the remaining count is compared to `limit`.
- Keys are built from `rateLimitKey(routeName, request)` = `routeName + ":" + clientIp`,
  where the client IP comes from the existing `getRequestIp` helper (`x-forwarded-for`
  first hop, then `x-real-ip`, falling back to `"unknown"`).
- Total distinct buckets are capped at ~10,000; when the cap is exceeded the oldest
  map entries are evicted (Map preserves insertion order) to bound memory.

### ⚠️ Per-instance memory caveat (IMPORTANT before scaling out)

The limiter state lives in a module-level `Map` inside a single Node process. This is
correct for a **single long-lived instance** (current dev/prod on ports 3009/3010).

It does **NOT** work as a global limit when the app is:
- deployed to a **serverless / edge** runtime (each invocation may be a fresh isolate → no shared counters), or
- horizontally scaled across **multiple instances / containers** behind a load balancer
  (each instance counts only the traffic it happens to receive).

**Upgrade path when moving to serverless or multi-instance:** swap the `Map` in
`lib/rateLimit.ts` for a shared store — **Upstash Redis** (`@upstash/ratelimit`) or a
Redis `INCR`+`EXPIRE` / sorted-set sliding window. The `rateLimit()` signature and the
call sites do not need to change; only the internal storage does. Keep the same
`routeName:ip` key scheme so limits carry over.

## Endpoints Covered & Limits Chosen

| Route | Method | Auth | Limit | Placement |
|---|---|---|---|---|
| `/api/signup` | POST | public | 5 / hour / IP | limiter first (before validation) |
| `/api/portal/auth/register` | POST | public | 5 / hour / IP | limiter first |
| `/api/portal/auth/login` | POST | public | 10 / min / IP | limiter first (credential-stuffing guard) |
| `/api/public/marketplace` | GET | public | 120 / min / IP | limiter first |
| `/api/r/[token]` | GET | public (share token) | 60 / min / IP | limiter first |
| `/api/portal/campaigns/join` | POST | creator session | 20 / hour / IP | limiter **after** auth |

Placement rules:
- **Public/unauthenticated** endpoints run the limiter **before** validation/lookup, so
  attempts are counted even when the payload fails validation.
- **Authenticated** endpoints (`join`) run the limiter **after** the auth check, so an
  unauthenticated caller receives `401`, never `429` — the limiter never leaks whether a
  resource/session exists.
- NextAuth-internal routes (`/api/auth/[...nextauth]`) are intentionally left untouched.

On a limit breach the route returns `429` with body `{ "error": "Too many requests" }`
and a `Retry-After` header (seconds until the oldest in-window request expires).

## Request-Scoped Logging

`lib/observability/requestLogger.ts` — `requestLogger(route, context?)` mints a
`requestId` via `crypto.randomUUID()` and returns a child of the existing structured
logger (`lib/observability/logger.ts`) bound to `{ route, requestId, ...context }`.

Wired into all six rate-limited routes above with `*.start` / `*.done` /
`*.rate_limited` lines. Logs are single-line JSON on stdout, respecting `LOG_LEVEL`.

### Payments webhook route

TASK 3 also called for entry/exit log lines in the payments webhook route. As of this
change **no payments webhook API route exists** in the codebase — `lib/payments/`
contains the webhook primitives (`recordWebhookEvent`, `markWebhookProcessed`) but they
are not yet wired to any `app/api/**/route.ts`. There was therefore nothing to
instrument without creating new payment wiring (out of scope). When a webhook route is
added, wrap its handler with `requestLogger("payments/webhook")` and emit one `.start`
and one `.done` line, with no changes to the verification/processing logic.
