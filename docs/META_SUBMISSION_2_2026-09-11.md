# Meta App Review — submission #2 (draft, not filed)

Covers the four permissions left out of the shipped 14: `pages_read_user_content`,
`read_insights`, `threads_basic`, `threads_manage_insights`.

**Status: draft.** Nothing here has been submitted. One prerequisite is still
open — see *Blocker* at the end.

Every claim below was measured against the deployed commit `620de6c`, not read
off an earlier doc. Where a previous doc disagrees, this file is the later
measurement.

---

## Why this is a second submission rather than a retry

The first submission asked for 14 permissions. Two of them had no user-facing
screen that exercised them, which is the ground Google rejected us on
(2026-09-08, "your video must demonstrate the maximum extent of the user facing
features"). `pages_read_user_content` in particular could never have passed a
testing counter: the app read comments only as a
`comments.summary(true).limit(0)` field expansion on the post edge, and Facebook
credits that to `pages_read_engagement`. No `/{post-id}/comments` call existed
anywhere in the codebase, so the permission's own counter stayed at zero no
matter how many times the app was exercised.

That gap is now closed in code. The Threads pair was pulled from submission #1
for the same reason — Meta's "0 of 1 API call" counter — and both scopes are
requested by the live OAuth config.

---

## The scopes, the feature, and the screen

Requested scopes, read out of `lib/oauth/providers.ts` at `620de6c`:

| Provider | Scopes actually requested |
|---|---|
| facebook | `pages_show_list`, `pages_read_engagement`, **`pages_read_user_content`**, **`read_insights`** |
| threads | **`threads_basic`**, **`threads_manage_insights`** |

### 1. `pages_read_user_content` — comment count and live preview

**Feature.** On a campaign post detail screen, a Page post shows its true
comment total and, on request, the most recent comments.

**Screen.** Campaign → post detail. The comments are **not** loaded with the
page: the client calls the route only when the viewer asks to see them, so
opening a post reads nobody's words.

**Endpoint.** `GET /{post-id}/comments` with
`fields=id,message,created_time,like_count,from{name}`, `filter=toplevel`,
`summary=true`, `order=reverse_chronological`.
Implemented in `lib/platforms/facebookPage.ts#fetchFacebookPostComments`,
surfaced by `app/api/campaigns/[id]/posts/[postId]/comments/route.ts`.

**Why the permission is necessary.** `pages_read_engagement` yields only a
summary count via field expansion, and that count is the one the agency cannot
reconcile against what it sees on Facebook. The comment total is a headline
campaign deliverable metric; `filter=toplevel` with `summary=true` is the only
way to report the total the reader actually sees, rather than the length of a
five-item preview.

**Data handling — the three properties the justification promises, each verified
in the deployed code:**

1. **Nothing is written.** `grep -nE "\.(create|update|upsert|delete|createMany|updateMany)\("`
   on the route returns no match. Its only database calls are three
   org-scoped reads (`db.campaign.findFirst`, `db.post.findFirst`,
   `db.creatorSocialAccount.findFirst`).
2. **Nothing is cached.** `export const dynamic = "force-dynamic"` and
   `export const revalidate = 0`, so a comment deleted at Facebook is gone from
   this screen on the next load rather than served from a stale copy.
3. **No comment body reaches a log.** The Graph helper logs `postId`,
   `returned` and `total` only. Comment text exists in the HTTP response and
   nowhere else.

There is also no column that *could* hold one: the only comment model in
`prisma/schema.prisma` is `CampaignComment`, which is keyed on a `userId` — an
organisation's own user discussing a campaign internally. No schema field
stores a platform commenter's words.

A commenter who has not authorised the app is returned by Facebook without a
`from` object. That is the common case since the 2018 platform changes, so an
anonymous comment is handled as normal rather than as an error.

### 2. `read_insights` — views on a Page post

**Feature.** The Views figure on a Page post row.

**Endpoint.** `post_media_view` for a single post
(`lib/platforms/facebookPage.ts:209`). Note for the reviewer: `post_impressions`
is deprecated above Graph v25 and returns 400, so `post_media_view` is the only
view count available on this edge.

**Why necessary.** Views is the metric a campaign is reported and paid on.
Nothing in `pages_read_engagement` provides it.

**Data handling.** A numeric count only, stored against the post row we already
own. No personal data is read by this scope.

### 3. `threads_basic` — identity and post list

**Feature.** The Threads profile card and the creator's recent Threads posts on
their own dashboard.

**Fields.** `id, username, name, threads_profile_picture_url,
threads_biography`; `me/threads` → `media_type, media_url, permalink, text,
timestamp, thumbnail_url`.

**Screen.** `/portal/dashboard`, the connected-account card for Threads.

### 4. `threads_manage_insights` — follower count and per-post metrics

**Feature.** Follower count on the profile card, and per-post views, likes,
replies, reposts and quotes on the post list.

**Why necessary, specifically.** The Threads **follower count is available
through no other scope** — `threads_basic` does not carry it. A creator
connecting Threads and seeing no audience figure is the failure this scope
fixes. The per-post metrics are the same campaign-reporting figures the other
platforms supply.

**Known absences to state up front rather than have a reviewer find:** Threads
exposes no verified flag and no total post count, and has **no token revoke
endpoint**, so Disconnect deletes our stored token and deliberately skips a
remote revoke call. That is a documented platform limitation, not an oversight.

---

## What the app reads, in the words shown to the creator

The consent copy on `/portal/settings` is live and reads:

> **What we read:** your public profile, follower count, and the view, like,
> comment and share counts on your public posts.
> **What we never touch:** direct messages, private or unpublished videos, and
> we never post, edit or delete anything.
> Revoke anytime with Disconnect below — we delete the stored tokens
> immediately.

Tokens are encrypted at rest with AES-256-GCM. CI enforces this on every
commit: `scripts/assert-no-plaintext-tokens.ts` fails the build if any
social-account token is stored in plaintext.

---

## Reviewer steps

1. Register a creator at `/portal/register` (open signup).
2. Join the open campaign from `/explore` — a creator with no campaign is not
   yet on an agency roster, and Connect requires one.
3. `/portal/settings` → Connect Facebook, and Connect Threads.
4. Threads profile card and post metrics appear on `/portal/dashboard`.
5. For the Facebook permissions, open the campaign post detail screen: Views
   comes from `read_insights`; choosing to show comments issues the
   `/{post-id}/comments` read that `pages_read_user_content` grants.

---

## Blocker before this can be filed

The screencast Meta requires must show each permission returning real data, and
that needs **one real Facebook Page and one real Threads account connected
through the live consent dialog**. No platform account credentials are available
to this environment, so the consent step cannot be completed here. Until it is,
`/api/portal/insights` returns `{"connected":false,"platforms":[]}` and the
demo screens render "—" rather than numbers.

Filing before that is what produced the "0 of 1 API call" counters the first
time. **Do not submit until the connect flow has been completed once and the
dashboard shows real figures.**
