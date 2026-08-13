# TikTok resubmission — Made Boring Campaigns

Prepared 13 August 2026. Supersedes the field table in
`../../docs/TIKTOK_SUBMISSION_PACKAGE.md` §8, which still names the app
`Outreach AI` on `app.prathamsharma.in`.

---

## 1. What TikTok actually said

Email received 12 August 2026 09:28 UTC, from `noreply@dev.tiktok.com`,
subject *"Your app status update"*. Body, in full:

> We are sorry to inform you that your app was not approved.
> After you make the required changes, resubmit for review.

That is the whole message. **No reasons are given in the email** — they sit
behind the "View App Details" link, which needs a portal login.

**The reason is now known.** It was read off the portal by a parallel session
that still holds a logged-in browser there, and it is one field, verbatim:

> Update the following fields and resubmit changes to your app: **Website
> URL**. Note from reviewer: *Website is not accessible., Invalid Website
> URL.*

App ID `7578018492050753548`. **Website URL is the only field cited.**

The persistent Playwright profile at `~/.cache/outreach-ai/tiktok-profile` is
still expired, so this session cannot re-read the portal itself; §5.1 stands
if it needs checking again.

---

## 2. Why the Website URL failed

### 2.1 The cited cause

The submitted Website URL was `https://app.prathamsharma.in`. It 302'd
cross-domain to `https://campaign.madeboring.com/login`. The chain, traced in
code and confirmed by curl:

```
app/page.tsx  redirect("/campaigns")  ->  proxy.ts auth middleware  ->  /login
```

`/` was **not in the public-route whitelist** in `lib/auth.config.ts`, so an
unauthenticated reviewer never saw anything but a login screen on another
domain. That is both halves of *"Website is not accessible., Invalid Website
URL."*

`app.prathamsharma.in` has since been removed outright (Vercel alias removed,
`app` CNAME deleted from the `prathamsharma.in` zone), so the submitted URL
now 404s. It cannot be resubmitted as-is.

### 2.2 What was fixed, and one thing that was not a cited reason

The fix on this branch addresses the cited cause directly: `/` is whitelisted
in `lib/auth.config.ts` and serves a real public product page returning 200,
with signed-in users still redirected to `/campaigns`.

Legal links were also added to all four auth pages, because the guidelines say
Privacy and Terms *"must be visible on the website URL without having to open
a menu"* and none of those pages carried either link. **This was not one of
the reviewer's reasons** — the reviewer cited Website URL only. It is
defensible hardening, not a diagnosed defect, and should not be described as
the latter.

### 2.3 A third rule will fail on resubmission unless the demo is re-recorded

The rule: for web, *the demo video's domain must match the submitted website
URL*. The current `tiktok-demo.mp4` was recorded on `app.prathamsharma.in`,
which no longer resolves at all (no A record, `curl` returns `000`). See
§5.4.

---

## 3. What changed in the code

Branch `worktree-madeboring-rebrand`, commits `d3c4bd1` and `68f76fd`.

**`/` is now a real signed-out product page.** What the product does, the five
campaign stages, and a per-platform statement of exactly what is read from a
connected account and what is never done with it. Privacy, Terms and Contact
sit in a footer that is always visible. Signed-in users still land on
`/campaigns`; the middleware makes that call in one place, so no other route
changed.

**Product name and domain moved under the Made Boring umbrella.**
`lib/brand.ts` is the single source for name, domain, umbrella and contact
addresses. The previous three renames each meant hunting literals across
about twenty files; the next one is a one-line change. `LEGAL` keeps its old
shape and derives from `BRAND`, so the privacy and terms pages needed no
edits at all.

**The OAuth redirect origin no longer falls back to localhost in production.**
An unset `APP_URL` used to resolve `redirect_uri` to `http://localhost:3009`,
which TikTok rejects outright. Dev behaviour is unchanged.

### Verified

| Check | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run build` | passes, 121 static pages |
| `npm run test:unit` | 979/979 pass |
| `npm run test:integration` | 697/700 pass |
| Production build served locally, `GET /` | **200**, was a 302 to `/login` |
| Same page, brand and legal links | 6 × "Made Boring Campaigns", `/privacy` and `/terms` both present, 0 × "Outreach AI" |
| `GET /campaigns` unauthenticated | still 302 to `/login` |
| `GET /explore`, `GET /terms` | still 200 |

The 3 integration failures are **pre-existing**, not caused by this work:
`syncNoOverwrite` and `syncHardening` both fail identically on pristine
`HEAD` (`TypeError: Cannot read properties of undefined (reading
'socialAccounts')` in the cron sync route). They arrived with the TikTok
Display API commit `e18a82a`, which taught the cron sweep to load
`creator.socialAccounts` without updating those two suites' mocks. Worth
fixing, but it is a separate defect.

---

## 4. Submission fields, ready to paste

| Field | Value |
|---|---|
| App name | `Made Boring Campaigns` |
| Category | `Business` |
| Website URL | `https://campaign.madeboring.com` |
| Terms of Service URL | `https://campaign.madeboring.com/terms` |
| Privacy Policy URL | `https://campaign.madeboring.com/privacy` |
| Redirect URI | `https://campaign.madeboring.com/api/portal/connections/tiktok/callback` |
| Products | Login Kit, Display API |
| Scopes | `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list` |

### Description (117 chars, under the 120 limit)

> Campaign management for talent agencies. Creators connect TikTok so agencies can track their public post performance.

### Scope justification

> `user.info.basic` and `user.info.profile` — we show the connected creator's
> nickname, avatar and profile link in the agency's creator list, so the
> agency can confirm the right account was linked before a campaign starts.
>
> `user.info.stats` — follower count is what campaign fees are agreed
> against, and it is displayed on the creator record the agency works from.
>
> `video.list` — the agency needs view, like, comment and share counts for
> the videos a creator published as campaign deliverables. Those figures
> populate the report the agency sends its client, and they are what the
> creator's payment is reconciled against. We only read videos of the creator
> who connected their own account.

---

## 5. What still needs a human

### 5.1 Read the actual rejection reasons

```bash
node webapp/scripts/tiktok-app-setup.mjs --login       # VPN on, log in by hand
node webapp/scripts/tiktok-app-setup.mjs --dump https://developers.tiktok.com/apps
```

The session persists, so this is once only. Until it is done, §2 is a
well-evidenced hypothesis and nothing more. If TikTok's stated reasons differ
from §2, their list wins.

### 5.2 Promote the build to production

The preview is deployed and healthy but sits behind Vercel Deployment
Protection, which exempts custom domains and so does not affect
`campaign.madeboring.com`:

```
madeboring-rebrand-pfql2o9n4-prathams-projects-371c8ade.vercel.app
```

Branch is pushed: `origin/worktree-madeboring-rebrand`.

```bash
cd webapp/.claude/worktrees/madeboring-rebrand
npx vercel deploy --prod --yes
```

### 5.3 Repoint three production env vars

`APP_URL`, `NEXT_PUBLIC_APP_URL` and `NEXTAUTH_URL` were last written 23 hours
before this session, and their values cannot be read back (encrypted, and
`vercel env pull` is a protected action here). **If any still points at
`app.prathamsharma.in`, the TikTok OAuth round trip will send a `redirect_uri`
on a domain that no longer resolves, and the connect flow dies.** Setting them
is safe either way:

```bash
cd webapp
for V in APP_URL NEXT_PUBLIC_APP_URL NEXTAUTH_URL; do
  npx vercel env rm  "$V" production --yes
  printf 'https://campaign.madeboring.com' | npx vercel env add "$V" production
done
npx vercel deploy --prod --yes    # env changes need a rebuild to take effect
```

### 5.4 Re-record the demo video on the new domain

The submitted video must be recorded on the submitted website URL. The current
file is on `app.prathamsharma.in`, which is dead.

```bash
cd webapp
DEMO_CREATOR_ID=cmsmctt4v000304jr8qg3oi7o node scripts/record-tiktok-demo.mjs
```

Do 5.2 and 5.3 first, or the recording captures the old brand.

### 5.5 Re-register OAuth redirect URIs on all three providers

Every callback is still registered on the deleted host. **TikTok, Google and
Instagram are all broken** until re-registered on `campaign.madeboring.com`:

```
https://campaign.madeboring.com/api/portal/connections/tiktok/callback
```

Remove the `app.prathamsharma.in` URIs in the same pass.

### 5.6 Re-verify the URL property — this gates the whole resubmission

The TikTok site-verification TXT
`tiktok-developers-site-verification=4ThqNhPvZWaXnlMiddWsbo-SB1jHOzvRt` sits
on the **`prathamsharma.in` apex**, i.e. the domain that was just deleted.
`madeboring.com` has no such record.

The four submitted URLs previously passed *because* `prathamsharma.in` was a
verified URL property. A fresh TXT has to be issued from the portal's
URL-properties tab and published on `madeboring.com` before the new URLs will
be accepted.

Complication: **`madeboring.com` DNS is on Cloudflare**
(`annalise`/`bradley.ns.cloudflare.com`), not Hostinger. `hapi` returns an
empty zone for it and there are no Cloudflare credentials in these sessions,
so publishing the TXT needs a Cloudflare login.

### 5.7 Untick Android and iOS in the submission

Both platform checkboxes are ticked and there are no mobile apps. The
guidelines say unneeded products delay review. Web only.

### 5.8 Confirm the demo video is still attached

The upload slots render empty in the portal, so it could not be confirmed that
the previously uploaded video is still there. Whatever is attached must have
been recorded on the domain being resubmitted as the Website URL — see §5.4.

### 5.9 Do not touch the scopes

All four (`user.info.basic`, `user.info.profile`, `user.info.stats`,
`video.list`) are already on the submission. No scope increase is needed and
none was asked for. This is noted because "fix the scopes" is a tempting wrong
turn on a rejected app.

### 5.6 Decide the contact address

`madeboring.com` **publishes no MX record**, so `pratham@madeboring.com` — the
address printed on the Made Boring homepage — hard-bounces today. The legal
pages therefore still use `prathamsharma7711@gmail.com`, which is monitored. A
reviewer who writes to a dead privacy address reads worse than one who writes
to an off-domain address that answers. Route mail for the domain, then flip
`NEXT_PUBLIC_CONTACT_EMAIL` and `NEXT_PUBLIC_PRIVACY_EMAIL`.

---

## 6. Support message to TikTok

Send **after** 5.2 and 5.3, because it states that the site changes are live.
Channel: the developer support portal at
`developers.tiktok.com/portal/support` (needs the same login as 5.1).

**There is a second, competing draft.** A parallel session composed a ticket
directly in the portal (category `support`, `enter_from_appId=7578018492050753548`,
topic Display API) and it is still **unsubmitted, pending Pratham's
go-ahead**. Pick one before sending; do not send both.

**Question 2 is already partly answered** — do not re-derive it. See
`TIKTOK_OFFICIAL_METRICS_ROUTES_2026-08-12.md` (untracked, in the shared
checkout): the richer post-metrics route is the **Accounts API on
`business-api.tiktok.com`** (reach, watch-time, impression sources, 24–48h
latency), gated behind a Lark application form, and on a **separate plane**
from `developers.tiktok.com` — separate account, separate app, separate
review. Research API is ineligible (non-profit), Commercial Content API is
ads and EU only. That file also documents how Whop does it via official OAuth
connections, and carries an 11-field form map with drafted answers.

---

Subject: Which product fits agency-side campaign reporting, and what else is available to us?

Hello,

We run Made Boring Campaigns (https://campaign.madeboring.com), a B2B campaign management tool for talent agencies and record labels. App ID 7578018492050753548 was reviewed and not approved on 12 August 2026 and we are preparing a resubmission. Three questions before we do.

1. Is Login Kit plus Display API the right pair for our use case?

An agency runs a campaign, briefs a set of creators, and needs the public performance of the specific videos those creators published for that campaign: view, like, comment and share counts. Those numbers go into the report the agency sends its client, and they are what the creator's payment is reconciled against. Creators connect their own TikTok account from a creator portal and can disconnect at any time. We never publish, edit or delete anything on a creator's behalf.

Today we use Login Kit v2 with user.info.basic, user.info.profile, user.info.stats and video.list, and we read metrics from /v2/user/info/, /v2/video/list/ and /v2/video/query/.

That covers creators who have authorised our app. It does not cover the case agencies run into most: a creator who was briefed and has posted, but who has not connected their account to our tool. Is there a product or scope that serves that case for a commercial business, or is creator authorisation the only supported path? If it is the only path we will design around it. We would rather have it confirmed than infer it.

2. What other APIs or products could an app like ours use?

From the public product list we concluded that Research API (academic and non-profit, US and EU), Content Posting API, Commercial Content API and Data Portability API do not apply to us. If any of those is in fact available to a commercial B2B tool in our category, or if there is a product that is not listed publicly, we would like to know before we build further.

3. Review feedback

The email we received did not include the specific reasons. Could you point us at them? Since the review we have moved the app to its own domain, replaced the login redirect at the site root with a full product page, and put the Privacy Policy and Terms of Service in the footer where they are visible without opening a menu. We want to fix what actually failed rather than guess.

Thank you,
Pratham Sharma
Made Boring, https://madeboring.com

---

## 7. Where TikTok post data comes from

The question was whether the post numbers the app shows actually come from
the source we tell TikTok they come from. They do, and in production there is
no other path that could produce them.

`fetchTikTokMetrics` in `lib/platforms/fetchPostMetrics.ts:157` resolves in a
fixed order:

1. **TikTok Display API** — `fetchTikTokMetricsDisplay` calls
   `fetchTikTokVideosByIds`, which is `/v2/video/query/`. Requires a video id
   and an access token, so it only fires for a creator who connected TikTok.
2. **SocialKit** — a paid third-party scraper, and it returns early unless
   `SOCIALKIT_API_KEY` is set.
3. **TikTok oEmbed** — `fetchTikTokOEmbed` at line 252 returns
   **`thumbnailUrl` and `caption` only**. It cannot return a count, because
   the function never reads one.

`SOCIALKIT_API_KEY` is **not present** in the Vercel production environment
(`vercel env ls production` lists 20 variables; none is SocialKit). Path 2 is
therefore dead in production.

**So every non-zero TikTok engagement number in the app came from TikTok's own
Display API.** A post by a creator who has not connected TikTok gets no counts
at all rather than estimated ones, which is what the Terms page already claims:
*"Where a platform does not expose a metric, Made Boring Campaigns does not
estimate or infer it."*

**Not verified at the database layer.** The intended cross-check — read the
stored counts for every TikTok post and re-fetch each one live — could not
run. `DATABASE_URL` in the local `webapp/.env` is refused by Neon with
`P1017 ConnectionClosed` on the first query, while TCP to
`ep-red-star-a1va7t04-pooler.ap-southeast-1.aws.neon.tech:5432` succeeds.
That points at a rotated or revoked credential in the local env file, not at
the network. Worth fixing on its own account.

---

## 8. CreatorCore

**No reply.** The sub-processor and DPA request sent to `support@creatorcore.co`
on 10 August 2026 has had no response as of 13 August. The mailbox holds three
messages from CreatorCore, all older than the request and all marketing:
`admin@creatorcore.co` (6 June 2025, welcome), and
`hi@updates.creatorcore.co` (25 June 2025 and 21 October 2025, feature
announcements). No bounce either, so the request was delivered and is simply
unanswered.

Their data source is still **not externally determinable**, and the empirical
finding in `TIKTOK_SUBMISSION_PACKAGE.md` §9.1 and §10 stands unchanged:
CreatorCore resolves an arbitrary TikTok post URL to live view counts within
seconds, including for a minutes-old post on a zero-follower account that has
never authorised them. No official TikTok API can do that, so they buy the
data or scrape it. Their Discovery search is a separate, pre-ingested
Elasticsearch index that could not find that same account at all.

Question 1 of the support message in §6 is the cheap way to settle whether
there is any official route to that capability before spending on a provider.
