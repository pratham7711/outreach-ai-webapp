# CreatorCore parity — measured diff

Reference run `2026-09-14T10-35-50` · ours run `2026-09-14T13-31-24` · generated 2026-09-14 13:35

Every number below was produced by **one function** (`probe.mjs`) evaluated on both
sides; only the resolver differs. Nothing here is a screenshot comparison.

## Headline

| | |
|---|---|
| landmark instances compared | **116** |
| differences found | **469** |
| …high severity (a different layout mode, colour, or >8px) | **10** |
| …medium (2–8px) | 0 |
| …low (0.5–2px) | 0 |
| mechanism-only (identical geometry, different CSS route) | 181 |
| not comparable (the two sides resolved different elements) | 22 |
| accepted (a deviation we chose, with a reason) | 256 |
| surfaces not measured (harness health < 60%) | 3 |
| their screens we have no counterpart for | 4 |

## Harness health

**3 paired surfaces were not measured** (under 60% of their landmarks resolved on at least one side): 1 short on ours, 2 short on the reference, 0 on both. They contribute no findings, so the counts above describe only the 116 instances that were compared.

| viewport | surface | ref resolved | ours resolved | short side |
|---|---|---|---|---|
| desktop-1600 | `fan-pages` | 38% | 75% | reference |
| desktop-1600 | `payouts` | 88% | 50% | ours |
| desktop-1600 | `campaign-reference-settings` | 57% | 71% | reference |

## Where the differences concentrate

| landmark | differences |
|---|---|
| `page.header-strip` | 132 |
| `shell.rail.group-first` | 60 |
| `shell.rail.items` | 60 |
| `shell.rail` | 50 |
| `page.title` | 45 |
| `page.primary-action` | 45 |
| `campaign.rail.items` | 28 |
| `campaign.rail` | 22 |
| `page.content-top` | 14 |
| `list.rows` | 13 |

| property | differences |
|---|---|
| `overflowX` | 57 |
| `justifyContent` | 42 |
| `position` | 40 |
| `alignItems` | 40 |
| `rect.w` | 37 |
| `marginBottom` | 32 |
| `gap` | 20 |
| `rowGap` | 20 |
| `paddingRight` | 19 |
| `paddingLeft` | 19 |
| `display` | 16 |
| `gridTemplateColumns` | 16 |
| `rel.*` | 12 |
| `flexWrap` | 11 |
| `color` | 10 |

## High-severity differences

A different layout *mode*, a different colour, or more than 8px. These are the
ones that make a screen read as a different product.

| viewport | surface | landmark | property | CreatorCore | ours | Δ |
|---|---|---|---|---|---|---|
| desktop-1600 | activations | `list.rows` | `resolved` | `present "Status"` | `unresolved` | — |
| desktop-1600 | calendar | `list.rows` | `resolved` | `present "Deliverables Calendar"` | `unresolved` | — |
| desktop-1600 | requests | `page.primary-action` | `resolved` | `present "Export Data"` | `unresolved` | — |
| desktop-1600 | recipients | `page.primary-action` | `resolved` | `present "New Recipient"` | `unresolved` | — |
| desktop-1600 | connections | `page.primary-action` | `resolved` | `present "New Connection"` | `unresolved` | — |
| desktop-1600 | settings-general | `list.rows` | `resolved` | `present " Pending"` | `unresolved` | — |
| desktop-1600 | settings-team | `list.rows` | `resolved` | `present "Lakshay Sharma medialkay@gmail.com Activ"` | `unresolved` | — |
| desktop-1600 | settings-account | `list.rows` | `resolved` | `present "Profile Update your personal details. To"` | `unresolved` | — |
| desktop-1600 | campaign-reference-overview | `list.rows` | `resolved` | `present "4 posts were added by Capzo a month ago "` | `unresolved` | — |
| desktop-1600 | campaign-reference-analytics | `page.primary-action` | `resolved` | `present "Add Module"` | `unresolved` | — |


## Accepted deviations

Differences we chose. Listed so they are never re-reported as defects, and so
the reason survives the person who made the decision.

- `shell.rail.group-first` `overflowX`: visible → hidden
  — deliberate clamp on user data (app/globals.css: '.cc-page-title' -- "Long campaign and list names are user data: clamp rather than push the action buttons off the row"). MEASURED 2026-09-14: `truncated` is FALSE on every surface that resolved each of these three landmarks, both sides -- page.title 44 ref / all ours, shell.rail.group-first 14 ref / 21 ours, page.primary-action 25 ref / 8 ours, zero truncations anywhere. So the declaration differs while the painted result is identical; it is a latent guard against a name longer than any in either dataset, not a visual difference. If a future run ever reports truncated:true on our side while the reference is false, this row must be removed -- the clamp would then be clipping something they show.
- `shell.rail.group-first` `marginBottom`: 0px → 8px
  — MEASURED 2026-09-14 on all 12 paired surfaces that resolve both rail landmarks: the PAINTED gap between the group label's bottom edge and the first nav item's top edge is 8px on their side and 8px on ours, delta 0.0px on 12/12, with pitch 48 on both. Their label carries margin-bottom 0 and the space comes from the container; ours carries the 8px itself. Same pixels, different mechanism -- the identical padding-vs-margin case already accepted for shell.rail.items' rowGap. It is exposed here only because geomMatch fails on this landmark for an unrelated and separately accepted reason (our label box is wider), so the report cannot bucket it automatically. If the measured gap ever stops being 8px on both sides this row must be removed -- it accepts a mechanism, not a number.
- `shell.rail.group-first` `color`: rgba(31, 60, 239, 0.36) → rgba(31, 60, 239, 0.85)
  — deliberate contrast fix (app/globals.css:333) -- their 0.36 measures 1.89:1 and fails WCAG AA; ours is retuned to pass, and we are not reverting an accessibility fix for parity
- `shell.rail.group-first` `borderTopColor`: rgba(31, 60, 239, 0.36) → rgba(31, 60, 239, 0.85)
  — deliberate contrast fix (app/globals.css:333) -- their 0.36 measures 1.89:1 and fails WCAG AA; ours is retuned to pass, and we are not reverting an accessibility fix for parity
- `shell.rail.group-first` `borderBottomColor`: rgba(31, 60, 239, 0.36) → rgba(31, 60, 239, 0.85)
  — deliberate contrast fix (app/globals.css:333) -- their 0.36 measures 1.89:1 and fails WCAG AA; ours is retuned to pass, and we are not reverting an accessibility fix for parity
- `shell.rail.group-first` `rect.w`: 174.5px → 220px
  — The rail's group label -- their 174.5px against our 220px, the full column width. MEASURED 2026-09-14 across all 12 paired surfaces: rect.x identical 12/12 (x=20 both sides), textAlign `start` 12/12, backgroundColor identical 12/12 (BOTH fully transparent, rgba(0,0,0,0)), border width identical 12/12, fontSize identical 12/12, ours wider-or-equal 12/12, and `truncated` false on both sides on every one. A transparent, borderless, left-aligned label at the same origin in the same font paints the same pixels no matter how wide its box is -- there is no edge to see. Held back from ACCEPTED in an earlier pass on the reasoning that it was 'not a deviation we chose'; that was wrong. It is not about intent, it is about whether anything is visible, and nothing is. The `when` predicate is what makes that safe to record: the moment our box is narrower than theirs, or either side truncates, the row stops matching and the finding returns.
- `page.title` `overflowX`: visible → hidden
  — deliberate clamp on user data (app/globals.css: '.cc-page-title' -- "Long campaign and list names are user data: clamp rather than push the action buttons off the row"). MEASURED 2026-09-14: `truncated` is FALSE on every surface that resolved each of these three landmarks, both sides -- page.title 44 ref / all ours, shell.rail.group-first 14 ref / 21 ours, page.primary-action 25 ref / 8 ours, zero truncations anywhere. So the declaration differs while the painted result is identical; it is a latent guard against a name longer than any in either dataset, not a visual difference. If a future run ever reports truncated:true on our side while the reference is false, this row must be removed -- the clamp would then be clipping something they show.
- `page.title` `rect.w`: 138.1px → 774px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.header-strip` `display`: flex → grid
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.header-strip` `alignItems`: normal → center
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.header-strip` `gridTemplateColumns`: none → 773.984px 478.938px
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.header-strip` `position`: relative → static
  — `position` only paints when something resolves against it. FALSIFYING TEST run 2026-09-14 on campaigns, clients, activations and settings/team: the header strip has ZERO absolutely- or fixed-positioned descendants on all four, and forcing position:relative on it moved ZERO of its 9-17 descendant boxes (every getBoundingClientRect identical before and after). static and relative are the same pixels here. If a descendant ever takes position:absolute this row must be removed -- it would then resolve against the page instead of the strip, and the declaration would start mattering.
- `page.content-top` `rel.below`: 4px → 0px
  — the reference has no single value here: rel.below on their own dashboard surfaces measures 0x4, 4x1, 8x1, 10x1, 15x1 (5 distinct values over 8 surfaces, no majority). Ours is 0px, inside their own 0-15 band, so this delta is bounded by their inconsistency rather than by ours. Accepted only while we stay inside that range -- a pixel outside it reports again.
- `page.primary-action` `overflowX`: visible → hidden
  — deliberate clamp on user data (app/globals.css: '.cc-page-title' -- "Long campaign and list names are user data: clamp rather than push the action buttons off the row"). MEASURED 2026-09-14: `truncated` is FALSE on every surface that resolved each of these three landmarks, both sides -- page.title 44 ref / all ours, shell.rail.group-first 14 ref / 21 ours, page.primary-action 25 ref / 8 ours, zero truncations anywhere. So the declaration differs while the painted result is identical; it is a latent guard against a name longer than any in either dataset, not a visual difference. If a future run ever reports truncated:true on our side while the reference is false, this row must be removed -- the clamp would then be clipping something they show.
- `page.primary-action` `paddingTop`: 0px → 4px
  — Their primary action carries no horizontal padding because it is a FIXED-WIDTH button; ours is padded and sizes to its label. MEASURED: adopting their fixed width clips our labels by 15.6px at 1280 and 44.4px at 1024, and the button's own overflow-x is hidden, so the clip is silent -- the text would simply be gone with no ellipsis. Their dataset's labels are shorter than ours; matching the declaration would match their CSS and break our screen. Deliberate, and revisit only if the button's labels are ever shortened.
- `page.primary-action` `paddingRight`: 0px → 12px
  — Their primary action carries no horizontal padding because it is a FIXED-WIDTH button; ours is padded and sizes to its label. MEASURED: adopting their fixed width clips our labels by 15.6px at 1280 and 44.4px at 1024, and the button's own overflow-x is hidden, so the clip is silent -- the text would simply be gone with no ellipsis. Their dataset's labels are shorter than ours; matching the declaration would match their CSS and break our screen. Deliberate, and revisit only if the button's labels are ever shortened.
- `page.primary-action` `paddingBottom`: 0px → 4px
  — Their primary action carries no horizontal padding because it is a FIXED-WIDTH button; ours is padded and sizes to its label. MEASURED: adopting their fixed width clips our labels by 15.6px at 1280 and 44.4px at 1024, and the button's own overflow-x is hidden, so the clip is silent -- the text would simply be gone with no ellipsis. Their dataset's labels are shorter than ours; matching the declaration would match their CSS and break our screen. Deliberate, and revisit only if the button's labels are ever shortened.
- `page.primary-action` `paddingLeft`: 0px → 12px
  — Their primary action carries no horizontal padding because it is a FIXED-WIDTH button; ours is padded and sizes to its label. MEASURED: adopting their fixed width clips our labels by 15.6px at 1280 and 44.4px at 1024, and the button's own overflow-x is hidden, so the clip is silent -- the text would simply be gone with no ellipsis. Their dataset's labels are shorter than ours; matching the declaration would match their CSS and break our screen. Deliberate, and revisit only if the button's labels are ever shortened.
- `page.primary-action` `rect.w`: 180px → 183.6px
  — Their primary action is a FIXED 180px box on every dashboard surface regardless of label -- MEASURED 2026-09-14: 'New Campaign', 'New Client', 'New Creator', 'New List', 'Export Data' and 'New Recipient' are all exactly 180 (and all exactly 200 on the campaign shell). Ours is min-width 180 that grows, so it is EXACTLY 180 on clients, creators and lists and 183.6 on campaigns alone, whose label is the longest. We are the outlier here, not them -- the reference-outlier rule correctly refuses to excuse this one, which is why it is written out by hand. It is accepted rather than fixed because both available fixes are worse than the 3.6px: a fixed width leaves 156px of content space (180 less our 12px padding each side) for 159.6px of icon plus text, so it clips the Plus icon or truncates the label; and shaving the padding to 10px is a magic number fitted to one label that the next longer one undoes. Capped at 4px and at ours-wider-than-theirs, so a real regression still reports.
- `page.title` `rect.w`: 236.6px → 1066.4px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.header-strip` `gridTemplateColumns`: none → 1066.38px 186.547px
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.title` `rect.w`: 269.8px → 936.4px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.title` `rect.h`: 24px → 30px
  — the reference disagrees with itself here: rect.h is 30 on 9 of 10 of their own dashboard surfaces and 24px on this one. Ours is 30px, which IS their modal value -- matching this surface would break the 9 that already agree. Re-bucketed from the data, not an allowlist: it fires only while ours equals their mode.
- `page.header-strip` `gridTemplateColumns`: none → 936.375px 316.547px
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.title` `rect.w`: 873.6px → 1072.9px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.header-strip` `gridTemplateColumns`: none → 1072.92px 180px
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.header-strip` `gap`: 0px 10px → 10px
  — The row axis paints NOTHING here. --cc-header-areas is a single row in this theme ("title actions"), so there is no second row for a row gap to sit between; the computed value still reports, but no pixel depends on it. MEASURED 2026-09-14: their own value is not consistent either -- `10px`, `0px 10px`, `normal` and `5px 0px` across 15 paired surfaces, so there is no single number to match. Ours stays at their most common 10px. Splitting --cc-header-row-gap out to match `discovery` was tried and reverted: it closed discovery and opened activations, a wash, because those are the only two surfaces where geomMatch fails (their activations strip is 1268 wide against 1263 elsewhere, and their discovery strip is 45 tall against 40) and mechanism properties are therefore exposed. The COLUMN axis is not accepted and still reports.
- `page.header-strip` `rowGap`: 0px → 10px
  — The row axis paints NOTHING here. --cc-header-areas is a single row in this theme ("title actions"), so there is no second row for a row gap to sit between; the computed value still reports, but no pixel depends on it. MEASURED 2026-09-14: their own value is not consistent either -- `10px`, `0px 10px`, `normal` and `5px 0px` across 15 paired surfaces, so there is no single number to match. Ours stays at their most common 10px. Splitting --cc-header-row-gap out to match `discovery` was tried and reverted: it closed discovery and opened activations, a wash, because those are the only two surfaces where geomMatch fails (their activations strip is 1268 wide against 1263 elsewhere, and their discovery strip is 45 tall against 40) and mechanism properties are therefore exposed. The COLUMN axis is not accepted and still reports.
- `page.title` `rect.w`: 269.8px → 1252.9px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.header-strip` `gridTemplateColumns`: none → 1252.92px 0px
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.header-strip` `rect.h`: 45px → 40px
  — the reference disagrees with itself here: rect.h is 40 on 9 of 10 of their own dashboard surfaces and 45px on this one. Ours is 40px, which IS their modal value -- matching this surface would break the 9 that already agree. Re-bucketed from the data, not an allowlist: it fires only while ours equals their mode.
- `page.title` `rect.w`: 112.2px → 1072.9px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.title` `rect.w`: 56.1px → 1072.9px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.primary-action` `paddingTop`: 0px → 8px
  — Their primary action carries no horizontal padding because it is a FIXED-WIDTH button; ours is padded and sizes to its label. MEASURED: adopting their fixed width clips our labels by 15.6px at 1280 and 44.4px at 1024, and the button's own overflow-x is hidden, so the clip is silent -- the text would simply be gone with no ellipsis. Their dataset's labels are shorter than ours; matching the declaration would match their CSS and break our screen. Deliberate, and revisit only if the button's labels are ever shortened.
- `page.primary-action` `paddingRight`: 0px → 16px
  — Their primary action carries no horizontal padding because it is a FIXED-WIDTH button; ours is padded and sizes to its label. MEASURED: adopting their fixed width clips our labels by 15.6px at 1280 and 44.4px at 1024, and the button's own overflow-x is hidden, so the clip is silent -- the text would simply be gone with no ellipsis. Their dataset's labels are shorter than ours; matching the declaration would match their CSS and break our screen. Deliberate, and revisit only if the button's labels are ever shortened.
- `page.primary-action` `paddingBottom`: 0px → 8px
  — Their primary action carries no horizontal padding because it is a FIXED-WIDTH button; ours is padded and sizes to its label. MEASURED: adopting their fixed width clips our labels by 15.6px at 1280 and 44.4px at 1024, and the button's own overflow-x is hidden, so the clip is silent -- the text would simply be gone with no ellipsis. Their dataset's labels are shorter than ours; matching the declaration would match their CSS and break our screen. Deliberate, and revisit only if the button's labels are ever shortened.
- `page.primary-action` `paddingLeft`: 0px → 16px
  — Their primary action carries no horizontal padding because it is a FIXED-WIDTH button; ours is padded and sizes to its label. MEASURED: adopting their fixed width clips our labels by 15.6px at 1280 and 44.4px at 1024, and the button's own overflow-x is hidden, so the clip is silent -- the text would simply be gone with no ellipsis. Their dataset's labels are shorter than ours; matching the declaration would match their CSS and break our screen. Deliberate, and revisit only if the button's labels are ever shortened.
- `page.title` `rect.w`: 233px → 1130.4px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.header-strip` `gridTemplateColumns`: none → 1130.38px 122.547px
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.title` `rect.w`: 125.9px → 1252.9px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.content-top` `rel.below`: 8px → 0px
  — the reference has no single value here: rel.below on their own dashboard surfaces measures 0x4, 4x1, 8x1, 10x1, 15x1 (5 distinct values over 8 surfaces, no majority). Ours is 0px, inside their own 0-15 band, so this delta is bounded by their inconsistency rather than by ours. Accepted only while we stay inside that range -- a pixel outside it reports again.
- `list.rows` `display`: flex → grid
  — Their row is flex, ours is a column grid -- the SAME mechanism already accepted on page.header-strip above, stated on a second landmark. The two properties are one decision written twice, so they are accepted together. The columns are not arbitrary: they were measured off their row and the row's painted result (height 90, ground rgb(243,245,252), full-bleed x=270 w=1310) is matched separately and still reports if it drifts.
- `list.rows` `gridTemplateColumns`: none → 640.016px 160px 120px 120px 120px 90px
  — Their row is flex, ours is a column grid -- the SAME mechanism already accepted on page.header-strip above, stated on a second landmark. The two properties are one decision written twice, so they are accepted together. The columns are not arbitrary: they were measured off their row and the row's painted result (height 90, ground rgb(243,245,252), full-bleed x=270 w=1310) is matched separately and still reports if it drifts.
- `list.rows` `rest.fontWeight`: 700 → 600
  — A harness artifact, PROVEN not inferred. `labelOf` takes the first text-bearing descendant of the row; on our side that is the Avatar's initials (600), not the recipient name. MEASURED 2026-09-14: our name element computes fontWeight 700, identical to theirs -- the two sides are reading different elements, not different weights. RecipientsClient.tsx was changed from an inline fontWeight 600 to var(--cc-list-row-name-fw) (700 in this theme) for exactly this row. The heuristic is deliberately NOT rewritten: its own comment records that `last` landed on the Pay button, so retuning it to fix this row breaks a different one.
- `page.title` `rect.w`: 149.4px → 1083.3px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.header-strip` `gridTemplateColumns`: none → 1083.27px 169.656px
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.title` `rect.w`: 144.9px → 1261px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.header-strip` `gridTemplateColumns`: none → 1261px 0px
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.header-strip` `marginBottom`: 0px → 16px
  — The SETTINGS shell only -- 16px is the value no other shell produces (the dashboard shell is 0px and the base token is a clamp). MEASURED 2026-09-14 via the page.content-top landmark on all five paired settings surfaces: the PAINTED gap between the header's bottom edge and the first in-flow content below it is 16px on their side and, after this change, 16px on ours -- identical on 5/5. They produce that space from the following element, we take it from the header's margin, so the property disagrees while the pixels agree. That is the same mechanism-not-drift case as the rail's padding-vs-margin row above, and it is NOT auto-bucketed as `mechanism` only because geomMatch fails on this landmark for an unrelated reason: their settings header is 1293x72 and ours is 1262.9x64.5, which is its own finding and still reports. The note that previously justified 0px here compared the margin-bottom PROPERTY (theirs computes 0) instead of the gap it paints, and read the resulting +14px content shift as damage -- the exact mechanism-vs-pixels mistake this harness exists to catch.
- `page.title` `rect.w`: 123.6px → 993.5px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.header-strip` `gridTemplateColumns`: none → 993.453px 267.547px
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.title` `rect.w`: 189.2px → 1261px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.title` `rect.w`: 185.3px → 1261px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.title` `rect.w`: 147.6px → 1074.9px
  — MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on 14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical 15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE on BOTH sides on every one of the 15. A box only shows where its contents land; left-aligned text at the same origin, same size and same ink paints the same pixels whether the box around it is 124px or 647px wide. The `when` predicate encodes exactly that: accepted only while ours is the WIDER box and nothing is truncated, so a grid column that ever starts clipping the title fails this row instead of hiding behind it.
- `page.header-strip` `gridTemplateColumns`: none → 1074.91px 186.094px
  — Their header strip is flex; ours is a two-column grid. ONE mechanism, and it paints nothing -- see the page.title rect.w row below for the measurement that establishes it (15/15 paired surfaces, same text origin, same ink, nothing clipped). The three properties are the same decision stated three ways, so they are accepted together. The grid is deliberate: it gives the subtitle its own row (--cc-header-areas "title actions" / "subtitle subtitle"), which is why page.header-strip rect.h is NOT accepted here and still reports.
- `page.header-strip` `rowGap`: 10px → 12px
  — The row axis paints NOTHING here. --cc-header-areas is a single row in this theme ("title actions"), so there is no second row for a row gap to sit between; the computed value still reports, but no pixel depends on it. MEASURED 2026-09-14: their own value is not consistent either -- `10px`, `0px 10px`, `normal` and `5px 0px` across 15 paired surfaces, so there is no single number to match. Ours stays at their most common 10px. Splitting --cc-header-row-gap out to match `discovery` was tried and reverted: it closed discovery and opened activations, a wash, because those are the only two surfaces where geomMatch fails (their activations strip is 1268 wide against 1263 elsewhere, and their discovery strip is 45 tall against 40) and mechanism properties are therefore exposed. The COLUMN axis is not accepted and still reports.
- `page.header-strip` `borderRadius`: 0px → 10px
  — the reference disagrees with itself here: borderRadius is 10 on 6 of 8 of their own campaign surfaces and 0px on this one. Ours is 10px, which IS their modal value -- matching this surface would break the 6 that already agree. Re-bucketed from the data, not an allowlist: it fires only while ours equals their mode.
- `page.header-strip` `backgroundColor`: rgba(0, 0, 0, 0) → rgb(255, 255, 255)
  — the reference disagrees with itself here: backgroundColor is rgb(255, 255, 255) on 6 of 8 of their own campaign surfaces and rgba(0, 0, 0, 0) on this one. Ours is rgb(255, 255, 255), which IS their modal value -- matching this surface would break the 6 that already agree. Re-bucketed from the data, not an allowlist: it fires only while ours equals their mode.
- `page.header-strip` `rect.w`: 1065.6px → 1362px
  — the reference disagrees with itself here: rect.w is 1362 on 6 of 8 of their own campaign surfaces and 1065.6px on this one. Ours is 1362px, which IS their modal value -- matching this surface would break the 6 that already agree. Re-bucketed from the data, not an allowlist: it fires only while ours equals their mode.
- `page.header-strip` `rect.h`: 53.5px → 100px
  — the reference disagrees with itself here: rect.h is 100 on 6 of 8 of their own campaign surfaces and 53.5px on this one. Ours is 100px, which IS their modal value -- matching this surface would break the 6 that already agree. Re-bucketed from the data, not an allowlist: it fires only while ours equals their mode.
- `campaign.rail` `rect.h`: 1063px → 1000px
  — the reference disagrees with itself here: rect.h is 1000 on 7 of 8 of their own campaign surfaces and 1063px on this one. Ours is 1000px, which IS their modal value -- matching this surface would break the 7 that already agree. Re-bucketed from the data, not an allowlist: it fires only while ours equals their mode.
- `campaign.rail.items` `flexDirection`: column → row
  — A one-child flex container paints the same in either direction, and theirs has one child. MEASURED 2026-09-14 at desktop-1600, all seven paired campaign surfaces: their row is a label and nothing else (derived.count 8, the eight section names), while ours carries an icon, the label and a count chip (derived.count 11 -- the eight plus an 'All campaigns' back link and two extra sections). Everything the direction could decide already agrees: rect 166.4x50 theirs against 166x50 ours, x 20.8 against 21, pitch 50 on both, gapEffective 0 on both, border-radius 10px on both, and the active row's colour, ground and weight identical. The declaration differs because the CONTENT differs; matching it would mean deleting the icons and the counts from our campaign nav, which is a feature change dressed up as a style fix.
- `campaign.rail.items` `rest.color`: rgba(255, 255, 255, 0.5) → rgba(255, 255, 255, 0.6)
  — The hue is theirs; the alpha is the contrast floor. MEASURED: white at 0.5 alpha over their rail's rgb(31,60,239) composites to rgb(143,158,247), which is 2.82:1 against that ground -- under the 3.0 floor e2e/contrast.spec.ts asserts on, and four campaign routes are in its PAGES list, so shipping their exact value would fail the deploy gate. 0.6 composites to rgb(165,177,249) and measures 3.46:1. This is the same trade already recorded for --cc-text-subtle: match the hue exactly, move the alpha the minimum that clears the floor, and say so.

## Not comparable

The landmark resolved on both sides, but to **different elements**, so any
delta between them measures the mismatch rather than a layout difference.
These are reported, never counted as parity differences, and each one is a
question about STRUCTURE — usually an element one side renders and the other
does not. MEASURED 2026-09-14: their five dashboard list pages carry a
record-count caption under the header ("200 Creators", "19 Lists") that we
do not render at all.

| viewport | surface | landmark | theirs | ours |
|---|---|---|---|---|
| desktop-1600 | activations → nav-activations | `page.header-strip` | 1268px "Creator Activations
LEARN MORE 👀" | 1262.9px "Activations
Add Activation" |
| desktop-1600 | calendar → nav-calendar | `page.header-strip` | 1270px "Deliverables Calendar" | 1262.9px "Calendar
September 2026
Today" |
| desktop-1600 | calendar → nav-calendar | `page.content-top` | 1270x40px "Team Member Sep 13 – 19, 2026   Week M" | 1262.9x18px "DRAFT PENDING IN PROGRESS COMPLETE CANCE" |
| desktop-1600 | requests → nav-requests | `page.header-strip` | 1268px "Requested Payouts
Export Data" | 1262.9px "Requests
Export Data" |
| desktop-1600 | connections → nav-connections | `page.content-top` | 1263x102.5px "CreatorConnect Using CreatorConnect you " | 1262.9x641px "Social Platforms 🎵 TikTok Recorded for " |
| desktop-1600 | settings-team → settings-team | `page.content-top` | 1293x709.3px "User List (5/5) Invite users to the plat" | 480x159px "1 Team Members 0 Pending Invites" |
| desktop-1600 | settings-notifications → settings-notifications | `page.content-top` | 1293x416.5px "Campaigns Customize settings for campaig" | 760x1492.5px "Campaigns 🎉 Campaign Created A new camp" |
| desktop-1600 | settings-integrations → settings-integrations | `page.content-top` | 1293x142px "Integrations Connect with Slack to recei" | 760x288.3px "💬 Slack Team notifications posted to a " |
| desktop-1600 | settings-account → settings-profile | `page.content-top` | 1293x686.5px "Profile Update your personal details. To" | 1293x2023.5px "General Basic organization details Organ" |
| desktop-1600 | campaign-reference-overview → campaign-overview | `page.title` | 166.9px "PLAYLIST (AUG)" | 113.9px "PARA PARA" |
| desktop-1600 | campaign-reference-creators → campaign-creators | `page.title` | 166.9px "PLAYLIST (AUG)" | 113.9px "PARA PARA" |
| desktop-1600 | campaign-reference-creators → campaign-creators | `page.content-top` | 1392x236.8px "Search Creators Deliverables New View No" | 1362x21px "15 Aug 2026 · 73 creators · 88 posts" |
| desktop-1600 | campaign-reference-drafts → campaign-drafts | `page.title` | 166.9px "PLAYLIST (AUG)" | 113.9px "PARA PARA" |
| desktop-1600 | campaign-reference-drafts → campaign-drafts | `page.content-top` | 1392x900px "All Not Reviewed Approved Declined Uploa" | 1362x21px "15 Aug 2026 · 73 creators · 88 posts" |
| desktop-1600 | campaign-reference-posts → campaign-posts | `page.title` | 166.9px "PLAYLIST (AUG)" | 113.9px "PARA PARA" |
| desktop-1600 | campaign-reference-posts → campaign-posts | `page.content-top` | 1392x885px "All Manual Total Posts 4 Total Views 18," | 1362x21px "15 Aug 2026 · 73 creators · 88 posts" |
| desktop-1600 | campaign-reference-analytics → campaign-analytics | `page.title` | 166.9px "PLAYLIST (AUG)" | 113.9px "PARA PARA" |
| desktop-1600 | campaign-reference-analytics → campaign-analytics | `page.content-top` | 1392x900px "Post Performance Total Views 18,627 Avg." | 1362x21px "15 Aug 2026 · 73 creators · 88 posts" |
| desktop-1600 | campaign-reference-financials → campaign-financials | `page.title` | 166.9px "PLAYLIST (AUG)" | 113.9px "PARA PARA" |
| desktop-1600 | campaign-reference-financials → campaign-financials | `page.content-top` | 1392x900px "Budget & Overview Total Budget Notes  C" | 1362x21px "15 Aug 2026 · 73 creators · 88 posts" |
| desktop-1600 | campaign-reference-documents → campaign-documents | `page.title` | 166.9px "PLAYLIST (AUG)" | 113.9px "PARA PARA" |
| desktop-1600 | campaign-reference-documents → campaign-documents | `page.content-top` | 1392x900px "Documents No documents added to this cam" | 1362x21px "15 Aug 2026 · 73 creators · 88 posts" |

## Mechanism-only differences

The box is the **same size in the same place** on both sides, but reached a
different way — their padding vs our margins, their `relative` vs our `fixed`.
**Do not "fix" these.** Acting on the `shell.rail` rows below would have taken a
rail that already measures 240×970 @10,15 with rows 220×40 at pitch 48 and made
it stop matching.

| viewport | surface | landmark | property | theirs | ours |
|---|---|---|---|---|---|
| desktop-1600 | campaigns | `shell.rail` | `justifyContent` | `space-between` | `normal` |
| desktop-1600 | campaigns | `shell.rail` | `position` | `relative` | `fixed` |
| desktop-1600 | campaigns | `shell.rail` | `overflowX` | `visible` | `hidden` |
| desktop-1600 | campaigns | `shell.rail` | `paddingRight` | `10px` | `0px` |
| desktop-1600 | campaigns | `shell.rail` | `paddingLeft` | `10px` | `0px` |
| desktop-1600 | campaigns | `shell.rail.items` | `flexWrap` | `wrap` | `nowrap` |
| desktop-1600 | campaigns | `shell.rail.items` | `justifyContent` | `flex-start` | `normal` |
| desktop-1600 | campaigns | `shell.rail.items` | `alignItems` | `normal` | `center` |
| desktop-1600 | campaigns | `shell.rail.items` | `gap` | `0px 10px` | `10px` |
| desktop-1600 | campaigns | `shell.rail.items` | `rowGap` | `0px` | `10px` |
| desktop-1600 | campaigns | `shell.rail.items` | `marginBottom` | `0px` | `8px` |
| desktop-1600 | activations | `shell.rail` | `justifyContent` | `space-between` | `normal` |
| desktop-1600 | activations | `shell.rail` | `position` | `relative` | `fixed` |
| desktop-1600 | activations | `shell.rail` | `overflowX` | `visible` | `hidden` |
| desktop-1600 | activations | `shell.rail` | `paddingRight` | `10px` | `0px` |
| desktop-1600 | activations | `shell.rail` | `paddingLeft` | `10px` | `0px` |
| desktop-1600 | activations | `shell.rail.items` | `flexWrap` | `wrap` | `nowrap` |
| desktop-1600 | activations | `shell.rail.items` | `justifyContent` | `flex-start` | `normal` |
| desktop-1600 | activations | `shell.rail.items` | `alignItems` | `normal` | `center` |
| desktop-1600 | activations | `shell.rail.items` | `gap` | `0px 10px` | `10px` |
| desktop-1600 | activations | `shell.rail.items` | `rowGap` | `0px` | `10px` |
| desktop-1600 | activations | `shell.rail.items` | `marginBottom` | `0px` | `8px` |
| desktop-1600 | calendar | `shell.rail` | `justifyContent` | `space-between` | `normal` |
| desktop-1600 | calendar | `shell.rail` | `position` | `relative` | `fixed` |
| desktop-1600 | calendar | `shell.rail` | `overflowX` | `visible` | `hidden` |
| desktop-1600 | calendar | `shell.rail` | `paddingRight` | `10px` | `0px` |
| desktop-1600 | calendar | `shell.rail` | `paddingLeft` | `10px` | `0px` |
| desktop-1600 | calendar | `shell.rail.items` | `flexWrap` | `wrap` | `nowrap` |
| desktop-1600 | calendar | `shell.rail.items` | `justifyContent` | `flex-start` | `normal` |
| desktop-1600 | calendar | `shell.rail.items` | `alignItems` | `normal` | `center` |
| desktop-1600 | calendar | `shell.rail.items` | `gap` | `0px 10px` | `10px` |
| desktop-1600 | calendar | `shell.rail.items` | `rowGap` | `0px` | `10px` |
| desktop-1600 | calendar | `shell.rail.items` | `marginBottom` | `0px` | `8px` |
| desktop-1600 | clients | `shell.rail` | `justifyContent` | `space-between` | `normal` |
| desktop-1600 | clients | `shell.rail` | `position` | `relative` | `fixed` |
| desktop-1600 | clients | `shell.rail` | `overflowX` | `visible` | `hidden` |
| desktop-1600 | clients | `shell.rail` | `paddingRight` | `10px` | `0px` |
| desktop-1600 | clients | `shell.rail` | `paddingLeft` | `10px` | `0px` |
| desktop-1600 | clients | `shell.rail.items` | `flexWrap` | `wrap` | `nowrap` |
| desktop-1600 | clients | `shell.rail.items` | `justifyContent` | `flex-start` | `normal` |

_…and 141 more._

## Screens they have that we do not

| their surface | note |
|---|---|
| trackers-sound | no sound-tracker screen in our app |
| trackers-creator | no creator-tracker screen in our app |
| settings-branding | branding lives in the white-label config, not a settings tab |
| settings-stories | no stories feature |

## Screens we have that they do not

Not failures — these are ours. They are listed so the count in the headline is
not read as coverage we are missing.

`campaign-performance` · `campaign-reviews` · `nav-analytics` · `nav-audit-log` · `nav-dashboard` · `nav-deadlines` · `nav-financial-reports` · `nav-inbox` · `nav-media-kits` · `nav-plans` · `nav-reports` · `settings-api-keys` · `settings-billing` · `settings-ingestion`
