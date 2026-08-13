# Session handover — campaign app + TikTok submission

Written 13 August 2026, consolidating several parallel Claude sessions down to
one. This is the single place to start from. The TikTok detail lives in
`TIKTOK_RESUBMISSION_2026-08-13.md`; this file is the map plus everything that
existed only inside another session's head.

---

## 1. Session census

Scope was the campaign app (`outreach-ai/webapp`) and the TikTok API
submission. Sessions were polled directly, not guessed at.

| Session | Working dir | Disposition |
|---|---|---|
| This one (bg `535673e4`) | `webapp/.claude/worktrees/madeboring-rebrand` | **Survivor.** Holds the rebrand + TikTok resubmission work. |
| `credentials exposure security [675b01]` | `outreach-ai/webapp` (shared checkout) | **Already ended.** Read-only the whole time, zero edits, zero commits. Nothing lost. |
| `Complete outreach campaign to production [b4bc78]` | unreported | Polled twice, no reply, idle 18h. Treat as finished; confirm before closing. |

Polled and **out of scope** — different projects, not consolidation
candidates, told to carry on:

- `madeboringleads [64cd13]` — `/Users/pratham/madeboring/site`, the
  marketing site rebuild. Mid-flight.
- `pratham-7e [560b48]` — `leegality/deal-collab-frontend`, STP-5246. Day job.

---

## 2. The one thing that can actually be lost

**Sprint 0 Task 1 Unit 2 is uncommitted, inside the WIP batch in the shared
checkout** at `/Users/pratham/Documents/Repositories/outreach-ai/webapp`.

Verified against `webapp/CURRENT_TASK.md:11`, quoting it:

> **Unit 2 (verified 16/16; lives in your working-tree WIP batch — NOT
> separately committed):** wired `encrypt()` into
> `POST /api/creators/[id]/social-accounts` (accessToken + refreshToken
> encrypted before `create`, AAD = `orgId` → cross-tenant-safe); fixed the
> false schema comment (`prisma/schema.prisma:445-446`). These edits are
> interleaved with your ~40-file WIP in `route.ts` + `schema.prisma` —
> **commit them with your batch**.

That is the AES-256-GCM token encryption wiring, the #1 P0 in
`docs/BUILD_TRACKER.md`, and the reason no real provider credential was
supposed to ship without it. Units 1 and 3 are committed (`bc016a2`,
`958c284`); only Unit 2 is loose.

**Do not `git reset`, `git checkout .`, `git clean` or "tidy" that working
tree. Commit it.** A peer session reported the batch as roughly 40 modified +
24 untracked files; that count is second-hand and unverified from here,
because this session is worktree-isolated and cannot run git against the
shared checkout.

---

## 3. Repo topology and push state (verified from here)

Two separate git repos, which is the usual source of confusion:

- `outreach-ai/` — outer repo, holds `docs/`, `landing/`, `scripts/`.
- `outreach-ai/webapp/` — its own repo, remote
  `github.com/pratham7711/outreach-ai-webapp.git`.

`git ls-remote --heads origin` on the webapp repo returns exactly two refs:

```
8f5f08e  refs/heads/master
fbdec57  refs/heads/worktree-madeboring-rebrand
```

So **`feat/webapp-session-2026-08-08` does not exist on the remote.** That
sounds worse than it is: this branch was cut from that branch's tip, and
`git merge-base --is-ancestor e18a82a fbdec57` returns true, so **every commit
in that branch's history is backed up on GitHub** as an ancestor of the pushed
branch. Only the branch *name* is local.

Net: the sole unbacked-up work in this project is the uncommitted WIP in §2.

Live worktree: `webapp/.claude/worktrees/madeboring-rebrand` @ `fbdec57`, four
commits ahead of `e18a82a`.

---

## 4. TikTok submission — state

Full detail in `TIKTOK_RESUBMISSION_2026-08-13.md`. The short version:

App was **rejected 12 August 2026**. The email carries no reasons; they are
behind a portal login the saved Playwright profile can no longer pass.

Done and verified on this branch: rebrand to Made Boring Campaigns on
`campaign.madeboring.com`, a real signed-out product page at `/` replacing the
login redirect, legal links on all four auth pages, OAuth origin no longer
falling back to localhost in production. tsc clean, build passes (121 static
pages), 979/979 unit tests. Integration 697/700, the 3 failures pre-existing
and proven so against pristine HEAD.

Four things still need a human, in order:

1. Read the real rejection reasons — `node webapp/scripts/tiktok-app-setup.mjs --login`, VPN on.
2. Promote to production — `npx vercel deploy --prod --yes` from the worktree.
3. Repoint `APP_URL`, `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL` to `https://campaign.madeboring.com`, then redeploy.
4. Re-record the demo video on the new domain, after 2 and 3.

Both the production deploy and the env-var writes were refused by the
permission classifier in this session. They are not blocked by anything
technical.

---

## 5. Carried over from sessions that are gone

From `credentials exposure security`, which ended after reporting:

- Pratham pasted a developer-portal / Instagram password into that session's
  chat. It was **not persisted anywhere** — no memory, no `.env`, no file —
  and was deliberately not relayed between sessions. It is gone with that
  transcript. If it is needed again, ask him.
- That session was blocked for a mundane reason: he gave the password but
  never the matching account email or username, and never said what it was
  for. Three readings were on the table — register a Meta/IG app, log in to
  test creator-connect end to end, or just pre-load the credential. **Still
  unanswered.**

Unrelated to this project but surfaced while polling, worth 30 seconds:
`/Users/pratham/madeboring/site` **has no git repo at all** — `git init` was
never run, so the whole logo pipeline and rebuilt components sit there with no
version control.

---

## 6. Open decisions

- What the Instagram / developer-portal credential was for (§5).
- Whether to keep the product name **Made Boring Campaigns** — chosen from the
  subdomain plus the umbrella brand; it is a one-line change in
  `lib/brand.ts` if not.
- Whether to fix the 3 pre-existing integration failures in `syncNoOverwrite`
  and `syncHardening` now or leave them. They arrived with `e18a82a`, which
  taught the cron sweep to load `creator.socialAccounts` without updating
  those two suites' mocks.
- `madeboring.com` publishes no MX record, so `pratham@madeboring.com` — the
  address printed on the Made Boring homepage — hard-bounces. Legal pages
  deliberately still use the monitored Gmail.
- The local `webapp/.env` `DATABASE_URL` is refused by Neon (`P1017`) while
  TCP to the host succeeds, i.e. a rotated credential. It blocked the
  database-layer half of the post-data provenance check.
