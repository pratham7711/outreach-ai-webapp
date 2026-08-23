# Merge review — `integrate/parity-and-trackers` → `master`

Reviewed 2026-08-23 against `master` at `f030142`. 144 commits, 377 files,
+30,449 / −4,551.

This is the pre-merge audit of the branch that carries the CreatorCore parity
work. It records what was checked, what was found, and what is left for a human.

---

## Verdict

**Ready to merge once the two conflicts below are resolved.** Nothing found in
the audit blocks the merge on its own; the one security finding and the four
failing tests were fixed in the course of the review.

Confidence: **82 / 100**. What it rests on, and what would raise it, is at the
bottom.

---

## 1. Tenancy and authentication

The repo's own rule is: *every API route calls `auth()` first, and `orgId` comes
from the session, never from the request body.* All 146 route files were checked
against it.

| | count |
|---|---|
| route files | 146 |
| with an auth / authorisation gate | 129 |
| ungated, public by design | 7 |
| ungated, needed explaining | 9 |
| NextAuth's own route, which re-exports its handlers | 1 |
| **taking `orgId` from the request body** | **0** |

The seven deliberate ones are the share-token routes, `/api/public/*`,
`/api/explore/*`, the signed webhook, the image proxy, the health probe and the
cron endpoints (gated by `CRON_SECRET`).

The 146th file is `app/api/auth/[...nextauth]/route.ts`, three lines that do
`export const { GET, POST } = handlers`. It is gated by NextAuth itself, and it
is counted separately here because a scan looking for
`export async function GET` does not see a re-export at all — worth knowing if
this audit is ever re-run.

Of the nine that needed explaining, eight turned out to be gated by something a
grep for `auth()` cannot see:

- `admin/cc-sync` — `authorize()` is the first statement of both `GET` and
  `POST`. It 404s when `CC_SYNC_TOKEN` is unset, and compares the bearer token
  with `timingSafeEqual` behind a length guard. `orgId` and `createdById` are
  resolved server-side and overwrite whatever the payload claims; only
  whitelisted tables are writable, and only via `createMany`.
- `invites/accept`, `campaign-invites/respond` — token-keyed lookups, with
  expiry and already-used checks.
- `kit/[token]`, `r/[token]` — token lookup plus an `isPublic` check; `r/[token]`
  also rate-limits at 60/min.
- `portal/auth/login`, `portal/auth/register` — credential endpoints, both
  rate-limited. `portal/auth/logout` clears a cookie.

The ninth is the finding below.

### Finding: an unauthenticated cross-org endpoint (fixed)

`app/api/creators/by-handle/[handle]/reviews/route.ts` had no gate of any kind.
It fetched every `Creator` row sharing a handle **across every org**, then every
`CreatorReview` on those rows, and returned the review text together with the
reviewing org's name and the campaign's title. No session, no token, no rate
limit, no `take`.

Its own comment called it public, and the public creator profile page does show
the same fields — but that page opens with a `CreatorUser` lookup and calls
`notFound()` when there is none, so it only ever speaks for a creator who signed
up for a public profile. The route skipped that check, which made it a way to
read reviews of creators who never opted into one, including the imported
CreatorCore roster.

Nothing called it: a grep for `by-handle` across every `.ts`, `.tsx`, `.md`,
`.json` and `.mjs` file in the repo returned the route itself and nothing else —
the page queries the database directly. `CreatorReview` also holds 0 rows today,
so the gap was latent rather than leaking.

**Deleted.** Reachable-by-URL dead code that bypasses its own page's opt-in gate
is not worth keeping. Restoring it is one `git revert` if it was meant as a
future public API — in which case it needs the `CreatorUser` check, a `take`,
and a rate limit before it ships.

---

## 2. The production schema

Production serves `master` and was built with `db push`, so it has no
`_prisma_migrations` table and **`migrate deploy` must never be run against
it**. `lib/creatorcore/parityDdl.ts` is therefore the entire migration story,
and it has to cover every schema change on the branch or the deploy half-works.

Checked mechanically — new models, new enums, and new columns on models that
already exist in `master`:

- 8 new models — `CampaignPhase`, `CcCampaign`, `CcPost`, `CcRecord`,
  `CcRefreshQueue`, `CcStatisticPost`, `Song`, `SyncSlot` — all present.
- 2 new enums — `PostFetchState`, `SyncSlotState` — both present.
- 23 new scalar columns across `Campaign`, `Creator`, `Organization` and `Post`
  — all present.
- 8 new relation fields, which correctly need no DDL.

**`parityDdl` covers every schema change on this branch.** No gap.

---

## 3. Secrets

Every added line in the `master...HEAD` diff — 38,286 of them — was scanned for
connection strings carrying passwords, cloud keys, private key blocks, provider
tokens, JWTs, bcrypt hashes, and credential-shaped assignments, with
placeholders excluded.

**The branch diff is clean: 0 matches, and 0 files whose name suggests
secrets.**

The first version of that scan was wrong, though, and worth recording because
the mistake is easy to repeat. It matched credential keywords on a `\b`
boundary — and an underscore is a word character, so `\bsecret\b` cannot match
inside `NEXTAUTH_SECRET`. Any `SCREAMING_SNAKE` credential name was invisible
to it.

Re-run without that boundary, across all 921 tracked files rather than only the
diff, it finds exactly one real credential:

- **`e2e/self-serve-wizard.spec.ts:6`** hardcodes a 44-character secret used to
  mint session cookies for the test. It is not a fixture — it is the live
  `AUTH_SECRET` from the gitignored `.env.local`.

It predates this branch (`730e908`, already on `master`) and it is the local
development secret, so it does not block this merge and nothing deployed is
exposed by it. It should still be rotated, and the spec should read the value
from the environment. Note that `playwright.config.ts` does not load dotenv,
which is presumably why it was inlined in the first place — so the fix is two
changes, not one, and its failure mode is every e2e auth injection breaking at
once. Left alone deliberately rather than fixed in passing.

The only other hit was the literal string `test-key-not-a-real-secret` in
`__tests__/integration/aiRouteEntitlements.test.ts` — a placeholder, correctly
harmless.

---

## 4. Tests

`npx tsc --noEmit` clean. `npm run build` passes. Unit and integration suites
pass.

The e2e suite had **13 failures** — not the 4 an unfinished log first suggested.
None was a broken feature. Twelve were assertions left behind by decisions the
branch made on purpose; one was a real regression that a stale assertion
happened to catch. In four groups:

**Deliberately parked features — 4 tests.** Payments and Inbox are parked: the
routes and tables stay, the entry points are gone (see the note on
`NAV_SECTIONS` in `components/NewSidebar.tsx`). So there is no "Pending Payouts"
tile, no Payouts link in the nav, and no Message button on the creator page.

- `dashboard › shows stat cards` and `dashboard › sidebar has navigation links`
  now name what the page actually draws, **scoped to `main`** — unscoped,
  "Creators" also matches the sidebar link, so the test would have passed with
  no tile on the page at all.
- `messaging (a)` and `messaging (d)` both start from the Message button and are
  now `test.fixme` with the reason. The inbox itself still works, which is why
  `(b)` and `(c)` beside them pass; unparking messaging makes these green with
  no rewrite.

**The campaign page's default tab — 1 test.** `tabFromParam` defaults to
`performance`, matching the reference app, and the budget tile lives on
Overview. `campaigns-detail › shows budget info` now asks for `?tab=overview`.

**Dropdowns are no longer selects — 4 tests.** This is the group that contained
the real regression. Replacing every native `<select>` with the portalled
`Dropdown` dropped the implicit `role="combobox"` a `<select>` carries. The
trigger already had `aria-haspopup="listbox"`, `aria-expanded` and
`aria-controls` — the collapsed-combobox pattern in full, minus the attribute
that names it — so assistive technology stopped announcing these as selects.
**Fixed in `components/ds/Dropdown.tsx`**, once, on the shared trigger.

The role alone does not fix the other three: Playwright's `selectOption()` only
drives a real `<select>`. The wizard cases now go through a
`selectFromDropdown` helper in `e2e/helpers.ts` — click the trigger by its
accessible name, click the option out of the portalled listbox. Two `/1
selected/` locators were also tightened to exact matches, because a new
missing-rate warning opens with "1 selected creator has no rate on file" and a
loose match hit both.

**Signup rate limiting — 4 tests, not a defect.** All four returned 429.
Signup is capped at 5/hour in per-instance memory, and the suite had been run
twice against a server that never restarted in between — self-inflicted by the
review, not the branch. A restart clears the counter.

### Verified after the fixes

- Six affected specs: **22 passed, 2 skipped** (the `fixme` pair), **0 failed**.
- `campaigns-detail` warm: **5/5**, the budget assertion in 953ms. It failed
  once at 15.4s on the first request to that route after a server restart —
  cold start, the same effect `e2e/helpers.ts` already documents, and it passes
  on every warm run.
- `npx tsc --noEmit` clean, `npm run build` passes, unit and integration green.

---

## 5. Blocking: two merge conflicts

`gh pr view 2` reports `CONFLICTING`. `master` moved six commits ahead, all in
the Instagram / cron-sync area this branch also touched. Two files conflict:

- **`lib/platforms/fetchPostMetrics.ts`** — `master` added
  `unavailableReason?: "instagram-auth"` and keeps `postedAt` required; this
  branch made `postedAt` optional ("Absent when the platform did not say. Never
  today's date as a stand-in"). Resolution is the union, plus one real decision:
  whether `postedAt` stays required. The branch's position is the better one —
  never fabricate a date — but `master`'s callers may lean on it.
- **`app/api/cron/sync-posts/route.ts`** — `master` adds `unavailable` to the
  digest log line; this branch has extra digest logic around it. Keep both.

Worth knowing: `master`'s commit *"Stop recording an unreadable Instagram post
as a successful sync"* is exactly the fix for the item this branch had flagged
as still open — the cron stamping `lastSyncedAt` on the no-counts path. Taking
`master`'s side of that conflict closes it.

---

## 6. Left for a human

- **The merge itself**, and the two conflicts above.
- **CreatorCore's extra statuses** — Need To Invoice, Invoiced, Paid, Paused.
  An enum change against a production database with no migration history is a
  decision, not a mechanical step.
- **The campaigns-list kebab menu**, still blocked on a capture of what its
  items are. Building it without one would be invention.
- **A searchable creator picker** — 1,837 creators currently sit in a scroll
  menu.
- **Rotate the dev `AUTH_SECRET`** committed in `e2e/self-serve-wizard.spec.ts`,
  and have the spec read it from the environment (which needs dotenv loading in
  `playwright.config.ts`).
- **Three dead files**: `components/ui/chart.tsx` and
  `components/ui/EmptyState.tsx` have no importers (the latter still carries
  banned `#F0F0FF`, `#8888AA` and `--color-primary`), and
  `components/charts/MonthlySpendChart.tsx` is rendered only by its own test.

---

## Confidence

**82 / 100.**

Resting on: mechanical checks over the whole surface rather than samples — all
146 routes, all 58 models against the DDL, all 38,286 added lines and then all
921 tracked files for secrets; a clean typecheck and build; unit and integration
green; and every one of the 13 e2e failures diagnosed to a cause and re-run
green rather than retried until it passed.

Held down by two things this review got wrong before it got them right, both
recorded above: a failure count read off an unfinished log, and a secret scan
whose word boundary hid `SCREAMING_SNAKE` credential names. Both were caught
here rather than downstream, but a review that needed correcting twice earns
less confidence than one that did not.

What would raise it:

- The conflict resolution built and tested, which needs the merge.
- A live pass over the deployed result, which needs the deploy.
- The full suite green in one run on a freshly restarted server. The six
  affected specs are green and the rest were green in the baseline, but the
  signup cap means one uninterrupted run is the only way to see all of it at
  once.
