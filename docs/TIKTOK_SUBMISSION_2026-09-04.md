# TikTok review — submission package, verified 4 September 2026

App ID `7578018492050753548` · `Made Boring Campaigns`

Supersedes `TIKTOK_RESUBMISSION_2026-08-13.md`, which is now three weeks stale:
its §5.6 treats URL-property verification as an open question needing a
Cloudflare login, and that is no longer true. Everything below was measured
against the live site on the date in the title, not carried forward.

---

## 1. What the reviewer will check, and what they will find

Every row was verified live today against `https://campaign.madeboring.com`.

| Guideline | State | Evidence |
|---|---|---|
| Website URL loads for a signed-out visitor | **200, zero redirects** | `curl -L /` → 200, `num_redirects=0` |
| Privacy + Terms visible without opening a menu | **pass** | `href="/privacy"` and `href="/terms"` in server-rendered root HTML; 0 `<details>` wrappers |
| Same on every auth page | **pass** | `/login`, `/signup`, `/forgot-password`, `/reset-password` all 200, all carry both links |
| Privacy Policy URL | **200** | `/privacy` |
| Terms of Service URL | **200** | `/terms` |
| URL property verified | **pass, file-based** | `/tiktokySo5KiHvhxmNWZuBi0iuFdu4Y7byTO6a.txt` serves 200 |
| Requested scopes == declared scopes | **pass in code** | `lib/oauth/providers.ts` lists exactly the four submitted |
| `redirect_uri` never resolves to localhost in prod | **pass** | `appBaseUrl()` falls back to `BRAND.url`, not localhost |
| Privacy policy discloses use per scope | **pass** | `/privacy` names each of the four scopes and what it reads |
| Retention stated | **pass** | logs 90 days; account closure 30 days |
| Revocation on disconnect is real, not just claimed | **pass** | `revokeTikTokToken` is called at `app/api/portal/connections/route.ts:84` before the row is deleted |
| Diagnostics endpoints not publicly readable | **pass** | `/api/diagnostics/tiktok-probe` → 401 |
| No stale brand or dead domain on the site | **pass** | 16× "Made Boring", 0× "Outreach AI", 0× `prathamsharma.in` |

**The August rejection reason is fixed.** The single cited field was *Website
URL — "Website is not accessible., Invalid Website URL."* The cause was `/`
302-ing cross-domain to a login page. `/` is now a public product page
returning 200 on the submitted domain.

**§5.6 of the old doc is resolved and needs no Cloudflare.** It assumed a DNS
TXT on `madeboring.com` was required, and flagged the missing Cloudflare login
as gating the whole resubmission. In fact a **file-based** URL property is in
place and serving, with token `ySo5Ki…` — distinct from the dead DNS token
`4ThqNh…` that sat on the deleted `prathamsharma.in` apex. No DNS change is
needed for any of the four submitted URLs.

---

## 2. Fields to submit

| Field | Value |
|---|---|
| App name | `Made Boring Campaigns` |
| Category | `Business` |
| Platform | **Web only — untick Android and iOS** |
| Website URL | `https://campaign.madeboring.com` |
| Terms of Service URL | `https://campaign.madeboring.com/terms` |
| Privacy Policy URL | `https://campaign.madeboring.com/privacy` |
| Redirect URI | `https://campaign.madeboring.com/api/portal/connections/tiktok/callback` |
| Products | Login Kit, Display API |
| Scopes | `user.info.basic`, `user.info.profile`, `user.info.stats`, `video.list` |

Description (117 chars, limit 120):

> Campaign management for talent agencies. Creators connect TikTok so agencies can track their public post performance.

Scope justification: unchanged from `TIKTOK_RESUBMISSION_2026-08-13.md` §4,
which is still accurate. Do not widen the scope set; all four are already
declared and each is demonstrated.

---

## 3. Blocked on a human — these cannot be done from a session

### 3.1 Portal login (blocks the submission itself)

There are **no TikTok portal credentials on this machine** (`~/.config/`
holds AWSVPNClient, creatorcore, gh, leegality-dc, neon, outreach-prod,
send-email — no tiktok), and the persistent Playwright profile the old doc
relied on, `~/.cache/outreach-ai/tiktok-profile`, **does not exist** — it was
lost in the Mac rebuild. The portal needs a hand login behind the VPN:

```bash
node scripts/tiktok-app-setup.mjs --preflight   # confirm the VPN exit node
node scripts/tiktok-app-setup.mjs --login       # log in by hand; session persists
```

### 3.2 Demo video (blocks approval, not submission)

**No demo video exists on disk.** TikTok's web rule is that the video's domain
must match the submitted Website URL, so a recording on the old domain would
fail the same field that failed in August.

`scripts/record-tiktok-demo.mjs` hardcoded `https://app.prathamsharma.in`,
which no longer resolves. **Fixed today** — it now defaults to
`https://campaign.madeboring.com` and honours `DEMO_APP_URL`.

Recording still needs a signed-in prod session, and
`~/.config/outreach-prod/credentials.env` currently holds placeholders, so it
cannot run unattended:

```bash
DEMO_CREATOR_ID=<id> node scripts/record-tiktok-demo.mjs
```

### 3.3 `TIKTOK_SCOPES` drift — fixed in code, no action needed

**Resolved.** `buildAuthorizeUrl` used to pass `process.env.TIKTOK_SCOPES`
through verbatim, so a stray value in one production variable could make the
app request a scope the portal entry does not declare -- which fails review on
its own, with every scope in the code still correct. The variable is sensitive
in production and reads back as `[SENSITIVE]`, so it cannot be audited from a
laptop.

`resolveScopes` now intersects the override with the declared set: it can
narrow the request, never widen it, and an override naming nothing declared
falls back to the declared four rather than requesting nothing. Six unit tests
in `__tests__/unit/lib/tiktokScopeOverride.test.ts` pin it, including the
general property that no override can produce a scope outside the declared
set.

The earlier advice to `vercel env rm TIKTOK_SCOPES production` is withdrawn:
deleting a variable whose value nobody can read was a guess, and this makes
the guess unnecessary.

### 3.4 Contact address stays off-domain, deliberately

`madeboring.com` publishes **no MX record** (re-checked today: 0 records), so
`pratham@madeboring.com` hard-bounces. The legal pages therefore use
`prathamsharma7711@gmail.com`, which is monitored. A reviewer who writes to a
dead privacy address reads far worse than one who writes to an off-domain
address that answers. Route mail for the domain before flipping
`NEXT_PUBLIC_CONTACT_EMAIL` and `NEXT_PUBLIC_PRIVACY_EMAIL`.

---

## 3.5 A reviewer needs an account, and there is no demo login

Measured today: `/` and `/explore` are public, but `/campaigns` and
`/creators` both 302 to `/login`. The TikTok integration lives behind that
wall -- connecting an account, and the campaign dashboard the connected data
is shown on, cannot be reached signed out.

TikTok's review requires working demo credentials whenever the app needs a
login, so the reviewer can exercise the integration rather than take the
video's word for it. **No demo account is recorded in any doc in this repo**,
and the submission fields in §2 have nowhere to put one because the portal
asks for it separately.

This is the most likely cause of a *second* rejection now that Website URL is
fixed: the first reviewer never got past the front door, so it was never
reached. What is needed:

- a real org on prod with a seeded campaign and at least one connected TikTok
  creator, so the dashboard shows actual metrics rather than empty state;
- credentials for it pasted into the review notes alongside the video;
- the account left enabled until the review closes.

**Correction (4 Sep, measured): it does not need prod admin credentials.**
An earlier draft of this section said the demo account could not be made
because `~/.config/outreach-prod/credentials.env` holds placeholders. That
conflated two different doors. Prod signup is **open and self-serve** --
`/signup` returns 200 to a signed-out visitor, `app/api/signup/route.ts` has
no invite code, allowlist or feature flag, and it creates the org as well as
the user. So the account can be made through the front door with any mailbox
we can read, and `secrets-sharmapratham290.env` is one.

What still needs a person is the decision, not the access: signing up writes a
real User and Organization into the production database, and this repo has no
route that deletes either -- `Campaign` soft-deletes, `User` and `Organization`
do not. That makes it a one-way write to prod, so it is being surfaced rather
than done.

Note also that the reviewer does not need pre-connected data. TikTok asks that
they can *exercise* the integration; an org with one campaign and a reachable
Connect TikTok button satisfies that, and connecting a live creator account is
circular anyway, since the OAuth being demonstrated is the thing under review.

---

## 4. Order of operations

1. Log in to the portal (3.1).
2. Read the current rejection reasons before changing anything — if TikTok's
   stated reasons differ from §1, their list wins.
3. Settle `TIKTOK_SCOPES` (3.3) and redeploy.
4. Record the demo video on `campaign.madeboring.com` (3.2).
5. Set the fields in §2, **untick Android and iOS**, attach the video.
6. Confirm the redirect URI is registered on the portal and that no
   `app.prathamsharma.in` URI remains.
7. Submit.
