# The MCP server

`POST https://campaign.madeboring.com/api/mcp`

One HTTP endpoint speaking JSON-RPC 2.0 over MCP's Streamable HTTP transport,
stateless: every request carries its own credential and nothing is remembered
between them. It is how a customer points Claude, or any other MCP client, at
their own campaign data.

## Connecting

Mint a key at **Settings to API keys**. It is shown once.

```
claude mcp add --transport http campaigns \
  https://campaign.madeboring.com/api/mcp \
  --header "Authorization: Bearer oai_YOUR_KEY_HERE"
```

Any other client takes the same three facts:

```json
{
  "mcpServers": {
    "campaigns": {
      "type": "http",
      "url": "https://campaign.madeboring.com/api/mcp",
      "headers": { "Authorization": "Bearer oai_YOUR_KEY_HERE" }
    }
  }
}
```

A browser session works too: a signed-in dashboard user hitting this route from
the same browser is authenticated by their NextAuth cookie. That is what makes
the endpoint testable from the app itself, and it is why the org check below is
not optional.

### What a caller needs

| Requirement | Where it is enforced |
|---|---|
| A valid credential (API key or session) | `lib/authenticate.ts` |
| The org's plan includes `api_access` (pro, enterprise) | `app/api/mcp/route.ts`, 403 |
| 120 calls per minute per **org**, not per key | `app/api/mcp/route.ts`, 429 with `Retry-After` |

An API key carries the whole organisation. It has no role, no campaign scope and
no expiry, so a key handed to a client is that client reading everything the org
has. Revoke it in the same screen that minted it.

## Protocol

- Versions spoken: `2025-06-18`, `2025-03-26`, `2024-11-05`. `initialize` echoes
  the client's version when we speak it and our newest when we do not.
- `GET` answers **405** with `Allow: POST`. There is no server-initiated SSE
  stream, and a client that opened one would wait for events that never come.
- Notifications (`notifications/*`, or any message with no `id`) are answered
  with **202** and no body, as the spec requires.
- `ping` is supported. Batched arrays are accepted for clients older than
  2025-06-18.
- A tool that **ran and failed** answers inside the result with `isError: true`,
  so the model can read the reason and choose another call. Only a call that
  never reached a tool (unknown tool, missing name, bad JSON) is a JSON-RPC
  error.

## The one rule that changes answers

**A counter no platform read has returned is `null`, never `0`.**

`Post.likesCount` defaults to `0` in the database, so an Instagram post nobody
has measured and a post with genuinely no likes are the same row. Every metric
this server returns goes through the same provenance test the dashboard tiles
use (`lib/metricDisplay.ts`), and every post carries:

- `measured` &mdash; the counters the platform actually returned, e.g.
  `["views","comments"]`. Instagram never returns likes for an account that has
  not connected to us, and never returns saves or shares for one at all.
- `notMeasuredReason` &mdash; why the last read came back empty, when it did.

Totals and engagement rates are computed **over measured posts only** and each
one reports its sample (`posts.measured`, `engagementSample`). A rate over six
of forty posts is a different claim from a rate over forty, and the caller is
given both numbers rather than one that hides the other.

The handshake's `instructions` field says all of this to the model before its
first call.

## Tools

Read-only unless noted.

| Tool | What it answers |
|---|---|
| `list_campaigns` | Campaigns, filtered by status or title, newest activity first |
| `get_campaign` | One campaign's full record |
| `get_campaign_performance` | Totals, per-platform split, top posts, and how much was measured |
| `list_posts` | Posts by campaign, creator, platform, status or date, sorted by views, date or engagement |
| `get_post` | One post by id or URL, with provenance and sync failures |
| `get_post_timeseries` | A post's snapshot history and the views gained across it |
| `list_creators` | The roster, by name |
| `search_creators` | Roster search narrowed by platform and follower range |
| `get_creator_performance` | One creator's totals and best posts, optionally within one campaign |
| `list_activations` | Who is booked on what, due dates, drafts, and what is overdue |
| `list_payouts` | Recorded payouts with totals per status **and currency** |
| `get_org_kpis` | Org-wide views, posts, engagement rate and recorded payout total |
| `get_refresh_status` | When a campaign was last refreshed and how long until it may be again |
| `refresh_campaign` | **Not read-only.** Re-reads every post from its platform |

Every list tool pages: pass `limit` (max 100) and `offset`, and read `total`,
`hasMore` and `nextOffset` back. Every tool returns the same object twice, as
JSON text and as `structuredContent`, so a client reading either cannot be told
a different story.

### refresh_campaign spends a shared allowance

It is the same operation as the dashboard's Refresh Data button, under the same
thirty-minute per-campaign limit, enforced inside `refreshCampaign` rather than
at either entrance. An agent cannot spend a campaign's platform allowance out
from under the person clicking the button, because the platform being rationed
does not distinguish them. Call `get_refresh_status` first; a refused call tells
you `retryAfterSeconds`.

It can take minutes on a large campaign (`maxDuration = 300`).

## Examples

Three questions, and the calls that answer them.

**"Which posts on the launch campaign did best, and what have we not measured?"**

```
list_campaigns { "search": "launch" }
get_campaign_performance { "id": "camp_...", "topPosts": 10 }
list_posts { "campaignId": "camp_...", "sort": "views", "limit": 50 }
```

The third call's `measured` fields are the answer to the second half: a post
with `["views","comments"]` has no like count to judge it by.

**"Is anyone late?"**

```
list_activations { "overdue": true }
```

Activations past their deliverable due date with no post filed against them.

**"How did this reel grow after we boosted it?"**

```
get_post { "postUrl": "https://instagram.com/reel/..." }
get_post_timeseries { "id": "post_...", "limit": 100 }
```

## Measured performance

Against a production-shaped copy of the database (18,676 posts, 515 campaigns,
the largest campaign holding 492 posts), on a production build.

Query time in Postgres, which is the part that transfers to production:

| Query | Execution |
|---|---|
| `list_posts` count, org-wide | 7.7ms |
| `list_posts` page of 100, ordered by views | 22.9ms |
| `list_posts` page of 100 at offset 18,000 | 84.1ms |
| `get_org_kpis`, both aggregates over every post | 12.4ms, 13.5ms |
| `get_campaign_performance` group-by on a 492-post campaign | 0.6ms |
| `list_activations` overdue | 0.1ms |

Wall-clock measured from this laptop is **not** representative: the e2e database
is in `us-east-1` and a single round trip from here is 215ms, so a tool costs
0.8&ndash;1.6s locally. Production runs Vercel `sin1` against Neon
`ap-southeast-1`, co-located, so the same tools are dominated by the query times
above plus three or four round trips: one to look up the API key, one to touch
its `lastUsedAt`, and one or two for the org's entitlements.

The org-wide reads are sequential scans of `Post`. At 18,676 rows that costs
tens of milliseconds and is fine. They are the queries to watch first if the
table grows an order of magnitude; `Post` is indexed on `campaignId`,
`creatorId` and `activationId`, so anything scoped to a campaign or a creator
stays on an index.

Payload, which is the agent's context budget:

| Result | Payload | Over the wire |
|---|---|---|
| `list_posts` limit 20 (the default) | 12KB | 26KB |
| `list_posts` limit 100 (the maximum) | 60KB | 128KB |

The wire figure is about twice the payload because the spec asks a tool that
returns `structuredContent` to also return the same JSON as text for older
clients. A client hands the model one of the two, not both.

A post costs 600 bytes. It was 787 until structural nulls and ids repeated
inside their own nested object were dropped: `campaignId` beside `campaign.id`
and `creatorId` beside `creator.id` were 13% of a page, and `mediaType: null`,
`notMeasuredReason: null` and an inactive tracker another 12%. **A null metric
is never dropped** &mdash; that null is the fact being reported.

Other measured behaviour: 25 concurrent tool calls all returned 200 with no
connection-pool failures; the 120/min limit fires with `Retry-After` on a burst
(80 accepted, 120 refused); and a missing, malformed or unknown key is 401.

The limit is per process. Vercel runs several, so it is a guardrail against a
runaway agent rather than a quota.

## Tenancy

Every query filters by the `orgId` on the authenticated credential, never on
anything in the request body. `Post`, `Activation` and `PostMetricSnapshot` have
no `orgId` column of their own, so they are scoped through their campaign
relation (`campaign: { orgId }`), and a tool that takes a `campaignId` checks
that the campaign belongs to the caller **before** reading a single row from it.
`__tests__/integration/mcpServer.test.ts` asserts the denial and then makes the
identical request as the owning org, so a passing test cannot be a missing row.

## Not here yet

- **No writes except `refresh_campaign`.** Adding a post from an agent needs the
  body of `app/api/campaigns/[id]/posts/route.ts` extracted into a shared
  function first: that route authenticates with a session rather than an API
  key, and it carries the author-mismatch guard. A second copy of that logic
  behind MCP would drift from the one the dashboard uses, which is the failure
  this product has already paid for elsewhere.
- **No OAuth.** Remote MCP clients that require OAuth 2.1 with dynamic client
  registration cannot connect with a bearer key. Claude Code can
  (`--header`), and so can any client that passes headers through.
- **No `resources` or `prompts`.** Neither is advertised in the handshake, so a
  request for one is correctly a "method not found".
- `lib/ai/mcp/toolAdapter.ts` converts the **in-app assistant's** tool registry
  into MCP descriptors and is a separate vocabulary from this one. Nothing
  serves it over HTTP today.
