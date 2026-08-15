# TikTok developer support ticket — DRAFTED, NOT SUBMITTED

Composed 2026-08-12 in the developer portal. Preserved here verbatim because the browser
session holding it is gone. **Nothing was sent.** Submitting requires Pratham's explicit
go-ahead on this exact text.

## Where it goes

- Form: `https://developers.tiktok.com/portal/support?category=support&enter_from_appId=7578018492050753548`
- Requires being logged in as `prathamsharma7711@gmail.com` (the stored password in
  `.secrets/tiktok.env` is stale and was rejected — 2 of 6 attempts burned; Pratham must type it)
- Requires a non-India egress (`vpn on`) — the portal returns 503 `legal_ban` from an Indian IP

## Field values

| Field | Value |
|---|---|
| Email address | `prathamsharma7711@gmail.com` |
| Subject | `Outreach AI (7578018492050753548) — Website URL fix before resubmission + correct product for post metrics` |
| Category | Support |
| Topic | Display API |
| App | Outreach AI |
| Attachment | none |

Topic dropdown options, for reference: Account Issues, Commercial Content API, Content Posting
API, Data Portability API, Developer Website, Display API, Docs, Embed, Green Screen Kit, Login
Kit, Short Drama, Mini Game, Organizations, Other, Research API, Sandbox, Share Kit, TikTok API,
Webhooks.

## Body — verbatim

```
App: Outreach AI (App ID 7578018492050753548). Our production review was declined today with the reviewer note "Website is not accessible., Invalid Website URL."

We have found the cause. The Website URL we submitted (https://app.prathamsharma.in) 302-redirected to a different domain and landed on a login page. We are retiring that domain; the product now lives on madeboring.com.

Before we resubmit, two questions so we do not consume another review cycle:

1) Website URL. We intend to submit https://madeboring.com — a public marketing site, no login required, with Terms of Service and Privacy Policy linked in the homepage footer. The TikTok integration itself runs on the subdomain https://campaign.madeboring.com, and our demo video shows that subdomain. Does the "demo video domain must match the website URL" requirement accept a subdomain of the submitted website URL? If it must be the exact host, we will instead submit https://campaign.madeboring.com and make its root a public page.

2) Post metrics. We request user.info.basic, user.info.profile, user.info.stats and video.list under Login Kit and the Display API. Creators authorise our app themselves from our creator portal, and we read only their own posts, so that agencies see verified performance for campaign posts instead of screenshots. Is the Display API the correct surface for this, or should a platform of our type apply for the Accounts API on TikTok for Business to obtain reach and watch-time fields? We would rather choose the right product now than submit twice.

We are not requesting Content Posting API, Research API or Data Portability API.

Thank you.
```

## Before re-typing this, check whether it still applies

Two of its premises may have moved since 2026-08-12:

- Question 1 assumes `campaign.madeboring.com/` is a login redirect. A peer session reports it has
  since shipped `/` as a public product page whitelisted in `lib/auth.config.ts`. If that is live,
  the exact-host option is already available and the question narrows to the video-domain rule.
- Question 1 also assumes `madeboring.com` will be the submitted URL. The apex has no DNS records
  and the zone is on Cloudflare, which we have no credentials for here.

Question 2 is unaffected and is the more valuable half of the ticket — see
`TIKTOK_OFFICIAL_METRICS_ROUTES_2026-08-12.md` for the research behind it.
