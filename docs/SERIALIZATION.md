# Serialization: where the JSON weight actually is

Measured 2026-09-15 against the `e2e-tests` branch (a prod-shaped copy: 512
campaigns, 18,703 posts, 1,831 creators) and the dev server on :3009. Every
number below came from running something, not from reasoning about formats.

The question this set out to answer was "migrate JSON to protobuf where it
helps most". The measured answer is that **protobuf does not help most anywhere
in this codebase**, and that the things which looked like protobuf wins were a
duplicate to delete and archives to compress. Both are worth more than the
encoding change would have been, so both are what shipped.

---

## 1. The duplicate: 27.7 MB written twice

`cc-import.mjs` mirrors every CreatorCore record into `CcPost` / `CcCampaign`
as `raw`, and then wrote **the same object a second time** into the app row's
own JSON bag:

| column | total | of which `__cc` |
|---|---|---|
| `Post.platformMetrics` | 27.58 MB | **25.65 MB (93%)** |
| `Campaign.typeConfig` | 2.07 MB | **2.05 MB (99%)** |

It was never a cheaper-to-reach cache — it was the same bytes:

```
18,638 of 18,638 posts with __cc join to a CcPost row whose raw is byte-identical
   506 of    506 campaigns    "      "  CcCampaign      "        "        "
     0 rows anywhere have a mirror that is missing or has drifted
```

and nothing has ever read it. Outside the importer the only mentions are one
doc comment (`lib/metricDisplay.ts:64`) and three test fixtures.

It was also **39.5% of every campaign posts-list response**, because that route
took the whole Post row. So this was a wire problem as much as a storage one.

**Fixed by** not writing it (`cc-import.mjs`, `cc-push-prod.mjs`), not shipping
it (`toPostDto`), and `scripts/creatorcore/drop-cc-duplicate.ts` to reclaim it
from rows that already have it. That script strips a row **only where the
mirror row exists and its `raw` compares equal in the database**, so the delete
is provably lossless per row; anything else is left alone and counted.

> The guard is not ceremony. The rounded-views repair reverted on 2026-09-15
> failed for exactly the missing version of it: it assumed two numbers measured
> the same thing instead of checking, wrote 64 rows, and 13 of 17 readable ones
> came out too high. Compare first, write second.

---

## 2. The wire: protobuf loses

`/api/campaigns/[id]/posts` on campaign "Playlists" (492 posts) — the Posts tab
is the campaign page's default view, and it fetches this from the client, so
this is the heaviest thing the dashboard does.

| | raw | gzip | **brotli** |
|---|---|---|---|
| JSON, as it shipped before | 1,233.9 KB | 97.1 KB | **80.2 KB** |
| JSON, DTO (no `__cc`, only rendered fields) | 493.2 KB | 50.0 KB | **44.1 KB** |
| protobuf, same DTO | 226.1 KB | 46.8 KB | **43.2 KB** |

Read the brotli column: it is what actually crosses the network. Protobuf buys
**0.9 KB — about 2%** over JSON once the duplicate is gone.

Against that it costs:

- **+12.3 KB gzipped** of client bundle (3.9 KB codec + 8.4 KB `protobufjs/minimal`),
  which is 13× more than one request saves;
- **2.13× slower to decode** — 1.13 ms vs 0.53 ms for 492 posts;
- **5.73× slower to encode** — 1.11 ms vs 0.19 ms, paid on every invocation.

The reason is not subtle: protobuf's field numbers exist to remove repeated key
names, and **brotli already removes them**. `JSON.parse` is native C++ in V8;
`protobufjs` decode is JavaScript. On a string-dense payload — ids, URLs,
handles, captions — there is nothing left for protobuf to win.

**The 45% saving in that table is the DTO, not the encoding.**

---

## 3. At rest: compression beats protobuf 4.3×

Storage is where protobuf *should* win, because Postgres only TOAST-compresses
values over ~2 KB and these rows sit under it — so unlike the wire, the
repeated key names are paid in full:

| column | rows | total | avg | compressed by PG |
|---|---|---|---|---|
| `Post.platformMetrics` | 18,653 | 27.58 MB | 1,550 B | 6% |
| `CcPost.raw` | 18,680 | 25.63 MB | 1,439 B | 4% |
| `CcRefreshQueue.raw` | 14,264 | 18.18 MB | 1,337 B | 5% |
| `CcStatisticPost.raw` | 18,502 | 17.29 MB | 980 B | **0%** |
| `Campaign.typeConfig` | 509 | 2.07 MB | 4,266 B | 99% |
| `CcCampaign.raw` | 506 | 2.05 MB | 4,255 B | 100% |

So the test was run on the **most favourable case available**:
`CcStatisticPost.raw` — numeric-dense (22 of 33 keys numeric), stable-schema
(6 distinct key-sets, zero keys whose value type varies), stored uncompressed.
Protobuf should be at its best here.

| `CcStatisticPost.raw`, extrapolated over the real 17.29 MB | |
|---|---|
| protobuf | 10.52 MB (−39%) |
| **JSON + gzip** | **2.45 MB (−86%)** |
| protobuf + gzip | 2.34 MB (−86%) |

**Plain compression saves 14.84 MB where protobuf saves 6.77 MB.** And gzip
needs no schema, which matters because these are *foreign* Bubble.io payloads:
a `.proto` over someone else's arbitrary JSON is a standing liability, and
protobuf's own guidance warns against both type changes and relying on
serialization stability.

---

## What shipped

1. **`__cc` is gone** from the writers and from the wire; `drop-cc-duplicate.ts`
   reclaims the 27.7 MB already stored.
2. **`toPostDto` is the single definition of the post-list response.** The route
   names its columns instead of returning the Post row, so a widened `select`
   cannot leak the bag back into the payload. Result: **1,263 KB → 505 KB**
   measured live, a 60% cut before compression.
3. **Protobuf exists and works, opt-in via `Accept: application/x-protobuf`.**
   Both encodings come from the same DTO and a round trip is asserted to return
   it unchanged, so they cannot drift. JSON is the default because the numbers
   above say it should be. Flipping the client over is one header.

## What did not, and why

**Compressing the `Cc*.raw` archives** is the largest remaining win — roughly
**55 MB across four columns** on the measurements above. It is left out of this
change because it touches the read and write path of the importer mirror
tables, which deserves its own diff rather than riding along with a wire fix.
That is the next thing to do here, and it is worth more than everything above
combined.

## Regenerating the codec

`lib/serialization/postList.generated.{js,d.ts}` is committed so the Vercel
build needs no protobuf toolchain. After editing the `.proto`:

```bash
npm run proto:gen
```

Schema rules, from protobuf.dev: every field `optional` or `repeated`, never
`required`; tags 1–15 spent on fields that are always set; a tag is never
reused or renumbered — retire one with `reserved`.
