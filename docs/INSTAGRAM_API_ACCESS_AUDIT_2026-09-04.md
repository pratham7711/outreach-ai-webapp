# Instagram API access — audit and App Review package

Prepared 4 September 2026 for `campaign.madeboring.com` (Vercel project
`outreach-ai`, team `prathams-projects-371c8ade`).

Scope of this document: what Instagram access the app **declares**, what Meta
**requires** for the endpoints we actually call, the gap between the two, and
what has to be submitted to close it.

---

## 1. Which Instagram API this app is on

`lib/oauth/providers.ts` sends creators to `www.facebook.com/v26.0/dialog/oauth`
and exchanges at `graph.facebook.com/v26.0/oauth/access_token`. Every read goes
to `graph.facebook.com/v26.0` (`lib/platforms/instagram.ts`).

That is **Instagram API with Facebook Login** — the older of Meta's two current
paths. It is not deprecated and has no announced shutdown date, but it carries a
structural cost worth naming: an IG Business account is reachable only *through
the Facebook Page it is linked to*, so a creator with no linked Page cannot
connect at all, no matter which permissions we hold. The newer **Instagram API
with Instagram Login** (`instagram_business_basic`) drops the Page requirement.
See §6.

The legacy **Instagram Basic Display API** (end-of-life 4 December 2024) is not
used anywhere in this codebase. Nothing here depends on it.

---

## 2. The two code paths that read Instagram

| Path | Token used | Where |
|---|---|---|
| **Business Discovery** — reads any *public Professional* account by handle | `INSTAGRAM_BUSINESS_TOKEN` (one server-side token, our own) | `lib/platforms/instagramBusinessDiscovery.ts` |
| **Creator token** — reads a connected creator's own media + insights | per-creator OAuth token, encrypted at rest | `lib/platforms/instagram.ts` (`resolveIgUserId` → media → `/insights`) |

Business Discovery is the path production actually runs on today. The creator
token path is wired but, per the note already in `providers.ts`, has almost
certainly never returned a number.

There is also a **keyless captioned-embed fallback** (`instagramEmbed.ts`) that
needs no permissions at all. It is the reason Instagram metrics survive a token
lapse, and it is not part of this audit.

---

## 3. Declared vs required

**What we request** (`lib/oauth/providers.ts`, as of this commit):

```
instagram_basic, instagram_manage_insights, pages_show_list, pages_read_engagement
```

**What Meta requires** for `business_discovery`, verbatim from its reference
page (read 4 September 2026):

> `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement`

…plus **`ads_management` or `ads_read`** *if* the token's User got their Page
role via Business Manager. Token type must be a Facebook **User** access token.

### The gap found

`pages_read_engagement` was **not** being requested. It has now been added.

The live audit in §7 confirmed this was a real defect, not a theoretical one:
the hand-minted token production actually runs on **does** hold
`pages_read_engagement`, while the connect funnel was not asking for it. Any
creator completing OAuth would therefore have received a strictly weaker token
than the one production works on.

This is the same class of omission as the `pages_show_list` bug already
documented in that file: a permission that no Graph call site names in a string,
so it reads as unused and never got asked for, while the endpoint that needs it
is the one production depends on. `pages_show_list` grants the Page *listing*;
`pages_read_engagement` grants the content and metadata hanging off that Page.

`business_discovery` needs **no** extra Meta *feature* — in particular not
"Instagram Public Content Access", which governs hashtag search. It is limited
to Business/Creator accounts by design; personal accounts are unreadable through
it regardless of permissions.

---

## 4. Standard vs Advanced Access — the part that actually gates the product

Requesting a scope in code does not grant it. Each permission sits at one of two
access levels:

- **Standard Access** — granted only to users who hold a *role on the app*
  (admin, developer, tester). Available immediately, no review.
- **Advanced Access** — required for any user without such a role. Needs **App
  Review** *and* **Business Verification**.

A multi-tenant product where third-party creators connect their own Instagram
accounts needs **Advanced Access on all four permissions**. At Standard Access
the connect funnel works for Pratham's own accounts and silently declines for
every real creator — which is indistinguishable, from the app's side, from a
creator who simply has no Instagram.

**This is the single most likely reason the creator-token path has never
produced a metric**, and it cannot be diagnosed from the code. It has to be read
off the App Dashboard (App Review → Permissions and Features) or a live token.

---

## 5. App Review submission package

Meta requires all of the following. Current review turnaround is reported at
roughly 20 days, and first-submission rejection is common.

| Item | State |
|---|---|
| Business Verification | **must be confirmed in the dashboard** |
| Privacy policy URL | ✅ `https://campaign.madeboring.com/privacy` (`app/(public)/privacy/page.tsx`) |
| Terms of service URL | ✅ `https://campaign.madeboring.com/terms` (`app/(public)/terms/page.tsx`) |
| Valid, reachable website URL | ✅ `https://campaign.madeboring.com` serves 200. **Do not submit `app.prathamsharma.in`** — that dead URL is exactly what failed TikTok review (see `TIKTOK_RESUBMISSION_2026-08-13.md`) |
| Working reviewer login | needed — a demo tenant credential Meta can use unattended |
| Screencast per permission | needed — see below |

### What each screencast must show

Meta wants the *use*, in the product, not a description of it.

- **`instagram_basic`** — a creator opening the portal, pressing Connect
  Instagram, completing the dialog, and their handle + profile appearing on the
  connection (`app/(portal)/portal/settings`).
- **`pages_show_list` + `pages_read_engagement`** — the same flow, narrated to
  show the linked Facebook Page being resolved to the IG Business account. These
  two are best demonstrated together since neither is separately visible.
- **`instagram_manage_insights`** — a campaign post's **views** counter being
  populated on the campaign screen. Views is the metric Instagram publishes
  nowhere but `/insights`, so this is the honest demonstration of the scope.

Only request scopes actually demonstrated. TikTok's review required declared and
used scopes to agree, and Meta applies the same standard — an undemonstrated
permission is a rejection reason.

---

## 6. Recommendation beyond the gap

Adding `pages_read_engagement` fixes a real defect, but it does not fix the
funnel. On the Facebook Login path a creator needs a Facebook Page linked to a
Professional Instagram account *and* must grant Page permissions — several steps
where influencer onboarding drops off, and one many creators cannot complete.

**Migrating creator connections to Instagram API with Instagram Login**
(`instagram_business_basic`) removes the Page requirement entirely. It is a
separate piece of work and should not be bundled into this fix, but it is the
higher-leverage change of the two.

Business Discovery would stay on the Facebook Login path either way — it is not
offered on Instagram Login.

---

## 7. Measured results — live audit, 3 September 2026 20:16 UTC

Read from production through `app/api/admin/instagram-access`. That route has
since been made inert (see Teardown below).

App **"Outreach AI"**, id `27669383676014179`. Token type `USER`, `is_valid: true`.

### Scopes actually granted on `INSTAGRAM_BUSINESS_TOKEN`

| Permission | Granted | Requested by our OAuth funnel |
|---|---|---|
| `instagram_basic` | yes | yes |
| `instagram_manage_insights` | yes | yes |
| `pages_show_list` | yes (target `872463439283803`) | yes |
| `pages_read_engagement` | yes (target `872463439283803`) | yes — **added by this audit** |
| `business_management` | yes (target `856537137010036`) | **no** |
| `public_profile` | yes | implicit |

`me/permissions` reports all six as `granted`. Nothing is `declined`.

`business_management` is granted but appears nowhere in `providers.ts`, which
means this token was minted by hand — Graph API Explorer or the App Dashboard —
and never came through the app's own funnel.

### Page and Instagram account

One Page: **"Morax"** (`872463439283803`), linked Instagram Business account
`prathams7711` (`17841407896095023`). Every `business_discovery` lookup in
production is therefore performed *as Pratham's own Instagram account*. There is
no second account and no fallback.

### `business_discovery` — works today

| Handle | HTTP | Followers |
|---|---|---|
| `natgeo` (control) | 200 | 268,642,136 |
| `cryptic.queenn` | 200 | 15,529 |
| `poetix._08` | 200 | 13,973 |
| `foryouamv` | 200 | 737,539 |

The last three are real tracked creators taken from the database, not
well-known controls — so this is not just the happy path for large verified
accounts. The production Instagram read path is fully functional.

### Access level — still unresolved

`debug_token` does not report Standard vs Advanced Access and no Graph endpoint
exposes it; it is visible only in the App Dashboard. The probes above are
consistent with *either* level, because the token holder is an app admin and
Standard Access is sufficient for a user holding an app role. This audit
therefore **cannot** settle §4 — that needs a Meta login.

### Database — 0 connections, 1,086 posts

| Metric | Value |
|---|---|
| Instagram creator connections | **0** |
| …with a live token | 0 |
| …expired | 0 |
| Instagram posts tracked | **1,086** |
| Newest Instagram snapshot | 2026-09-03T18:01:27Z |

No creator has ever connected Instagram, yet 1,086 posts are tracked with
snapshots current to the hour. Production reads Instagram *exclusively* through
`business_discovery` on that one hand-minted token; the OAuth funnel is unused
in production today. That is precisely why the missing `pages_read_engagement`
had never produced a visible failure — and why it would have failed the first
real creator to connect.

### The live risk, now measured rather than guessed

`expires_at = 1789712360` → **18 September 2026**, **14.4 days** after this
audit. (The 2 September brain note estimated ~16 September; the true date is the
18th.) `data_access_expires_at` → 18 October 2026, 44.5 days.

Facebook issues no refresh token for this grant and there are **zero** creator
connections to fall back on. On 18 September all 1,086 posts stop updating
*silently* — the cron records unmeasured reads, not an outage.

**The fix is not "re-mint the same token".** `business_management` is already
granted and a Business (`856537137010036`) exists, so the durable options are,
best first:

1. **System User token** via Business Manager — does not expire. The correct
   shape for a server-side integration.
2. **Long-lived Page access token** derived from a long-lived user token — Page
   tokens obtained this way do not expire.
3. Re-mint the 60-day user token and diarise it. This restarts the same clock
   and will eventually be forgotten.

### Teardown

`IG_AUDIT_TOKEN` was removed from Vercel Production and the app redeployed
(`outreach-34r62s2jn`). The route now returns **404 both with and without** the
old bearer, verified live against `campaign.madeboring.com`; the token file was
shredded from the scratchpad. The route source stays in the tree deliberately —
it is inert without the variable, and it is the cheapest way to re-run this
audit once the token is replaced.
