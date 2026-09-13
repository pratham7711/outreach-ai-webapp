# CreatorCore parity — measured diff

Reference run `2026-09-13T19-01-43` · ours run `2026-09-13T20-36-12` · generated 2026-09-13 20:38

Every number below was produced by **one function** (`probe.mjs`) evaluated on both
sides; only the resolver differs. Nothing here is a screenshot comparison.

## Headline

| | |
|---|---|
| landmark instances compared | **67** |
| differences found | **475** |
| …high severity (a different layout mode, colour, or >8px) | **250** |
| …medium (2–8px) | 31 |
| …low (0.5–2px) | 19 |
| mechanism-only (identical geometry, different CSS route) | 145 |
| accepted (a deviation we chose, with a reason) | 30 |
| surfaces not measured (harness health < 60%) | 10 |
| their screens we have no counterpart for | 4 |

## Harness health

**10 paired surfaces were not measured** (under 60% of their landmarks resolved on at least one side): 9 short on ours, 1 short on the reference, 0 on both. They contribute no findings, so the counts above describe only the 67 instances that were compared.

| viewport | surface | ref resolved | ours resolved | short side |
|---|---|---|---|---|
| desktop-1600 | `campaign-reference-overview` | 83% | 33% | ours |
| desktop-1600 | `campaign-reference-creators` | 83% | 33% | ours |
| desktop-1600 | `campaign-reference-drafts` | 83% | 33% | ours |
| desktop-1600 | `campaign-reference-posts` | 100% | 33% | ours |
| desktop-1600 | `campaign-reference-analytics` | 100% | 33% | ours |
| desktop-1600 | `campaign-reference-financials` | 67% | 33% | ours |
| desktop-1600 | `campaign-reference-documents` | 83% | 33% | ours |
| desktop-1600 | `campaign-reference-settings` | 67% | 33% | ours |
| desktop-1600 | `fan-pages` | 43% | 71% | reference |
| desktop-1600 | `payouts` | 100% | 57% | ours |

## Where the differences concentrate

| landmark | differences |
|---|---|
| `page.header-strip` | 158 |
| `shell.rail` | 70 |
| `shell.rail.items` | 68 |
| `shell.rail.group-first` | 60 |
| `list.rows` | 51 |
| `page.title` | 47 |
| `page.primary-action` | 21 |

| property | differences |
|---|---|
| `overflowX` | 39 |
| `rect.w` | 37 |
| `marginBottom` | 35 |
| `position` | 29 |
| `alignItems` | 28 |
| `justifyContent` | 23 |
| `paddingTop` | 23 |
| `paddingRight` | 23 |
| `paddingBottom` | 23 |
| `paddingLeft` | 23 |
| `gap` | 21 |
| `rowGap` | 21 |
| `rect.h` | 20 |
| `display` | 17 |
| `gridTemplateColumns` | 17 |

## High-severity differences

A different layout *mode*, a different colour, or more than 8px. These are the
ones that make a screen read as a different product.

| viewport | surface | landmark | property | CreatorCore | ours | Δ |
|---|---|---|---|---|---|---|
| desktop-1600 | campaigns | `shell.rail.group-first` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | campaigns | `shell.rail.group-first` | `rect.w` | `174.5px` | `220px` | +45.5 |
| desktop-1600 | campaigns | `shell.rail.items` | `active.backgroundColor` | `rgba(31, 60, 239, 0)` | `rgb(31, 60, 239)` | — |
| desktop-1600 | campaigns | `page.title` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | campaigns | `page.title` | `rect.w` | `138.1px` | `772px` | +633.9 |
| desktop-1600 | campaigns | `page.header-strip` | `display` | `flex` | `grid` | — |
| desktop-1600 | campaigns | `page.header-strip` | `alignItems` | `normal` | `center` | — |
| desktop-1600 | campaigns | `page.header-strip` | `gridTemplateColumns` | `none` | `771.984px 478.938px` | — |
| desktop-1600 | campaigns | `page.header-strip` | `position` | `relative` | `static` | — |
| desktop-1600 | campaigns | `page.header-strip` | `marginBottom` | `0px` | `32px` | +32.0 |
| desktop-1600 | campaigns | `page.header-strip` | `rect.h` | `40px` | `73px` | +33.0 |
| desktop-1600 | campaigns | `page.primary-action` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | campaigns | `page.primary-action` | `paddingRight` | `0px` | `12px` | +12.0 |
| desktop-1600 | campaigns | `page.primary-action` | `paddingLeft` | `0px` | `12px` | +12.0 |
| desktop-1600 | campaigns | `list.rows` | `justifyContent` | `space-between` | `normal` | — |
| desktop-1600 | campaigns | `list.rows` | `alignItems` | `normal` | `center` | — |
| desktop-1600 | campaigns | `list.rows` | `position` | `relative` | `static` | — |
| desktop-1600 | campaigns | `list.rows` | `gap` | `0px 8px` | `14px` | +14.0 |
| desktop-1600 | campaigns | `list.rows` | `rowGap` | `0px` | `14px` | +14.0 |
| desktop-1600 | campaigns | `list.rows` | `paddingTop` | `0px` | `14px` | +14.0 |
| desktop-1600 | campaigns | `list.rows` | `paddingBottom` | `0px` | `14px` | +14.0 |
| desktop-1600 | campaigns | `list.rows` | `rest.color` | `rgba(31, 60, 239, 0.5)` | `rgb(31, 60, 239)` | — |
| desktop-1600 | campaigns | `list.rows` | `rest.backgroundColor` | `rgb(243, 245, 253)` | `rgb(255, 255, 255)` | — |
| desktop-1600 | campaigns | `list.rows` | `rest.fontWeight` | `400` | `600` | — |
| desktop-1600 | campaigns | `list.rows` | `rest.borderRadius` | `10px` | `12px` | — |
| desktop-1600 | campaigns | `list.rows` | `rect.w` | `200px` | `1262.9px` | +1062.9 |
| desktop-1600 | campaigns | `list.rows` | `rect.h` | `40px` | `86px` | +46.0 |
| desktop-1600 | campaigns | `list.rows` | `pitch` | `0` | `85.5` | +85.5 |
| desktop-1600 | campaigns | `list.rows` | `gapEffective` | `-40` | `12` | +52.0 |
| desktop-1600 | activations | `shell.rail.group-first` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | activations | `shell.rail.group-first` | `rect.w` | `174.5px` | `220px` | +45.5 |
| desktop-1600 | activations | `shell.rail.items` | `active.backgroundColor` | `rgba(31, 60, 239, 0)` | `rgb(31, 60, 239)` | — |
| desktop-1600 | activations | `page.title` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | activations | `page.title` | `rect.w` | `236.6px` | `1064.4px` | +827.8 |
| desktop-1600 | activations | `page.header-strip` | `display` | `flex` | `grid` | — |
| desktop-1600 | activations | `page.header-strip` | `alignItems` | `normal` | `center` | — |
| desktop-1600 | activations | `page.header-strip` | `gridTemplateColumns` | `none` | `1064.38px 186.547px` | — |
| desktop-1600 | activations | `page.header-strip` | `position` | `relative` | `static` | — |
| desktop-1600 | activations | `page.header-strip` | `marginBottom` | `0px` | `32px` | +32.0 |
| desktop-1600 | activations | `page.header-strip` | `rect.h` | `40px` | `73px` | +33.0 |
| desktop-1600 | calendar | `shell.rail.group-first` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | calendar | `shell.rail.group-first` | `rect.w` | `174.5px` | `220px` | +45.5 |
| desktop-1600 | calendar | `shell.rail.items` | `active.backgroundColor` | `rgba(31, 60, 239, 0)` | `rgb(31, 60, 239)` | — |
| desktop-1600 | calendar | `page.title` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | calendar | `page.title` | `rect.w` | `269.8px` | `934.4px` | +664.6 |
| desktop-1600 | calendar | `page.header-strip` | `display` | `flex` | `grid` | — |
| desktop-1600 | calendar | `page.header-strip` | `alignItems` | `normal` | `center` | — |
| desktop-1600 | calendar | `page.header-strip` | `gridTemplateColumns` | `none` | `934.375px 316.547px` | — |
| desktop-1600 | calendar | `page.header-strip` | `position` | `relative` | `static` | — |
| desktop-1600 | calendar | `page.header-strip` | `marginBottom` | `0px` | `32px` | +32.0 |
| desktop-1600 | calendar | `page.header-strip` | `rect.h` | `40px` | `63px` | +23.0 |
| desktop-1600 | clients | `shell.rail.group-first` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | clients | `shell.rail.group-first` | `rect.w` | `174.5px` | `220px` | +45.5 |
| desktop-1600 | clients | `shell.rail.items` | `active.backgroundColor` | `rgba(31, 60, 239, 0)` | `rgb(31, 60, 239)` | — |
| desktop-1600 | clients | `page.title` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | clients | `page.title` | `rect.w` | `873.6px` | `1070.9px` | +197.3 |
| desktop-1600 | clients | `page.header-strip` | `display` | `flex` | `grid` | — |
| desktop-1600 | clients | `page.header-strip` | `alignItems` | `normal` | `center` | — |
| desktop-1600 | clients | `page.header-strip` | `gridTemplateColumns` | `none` | `1070.92px 180px` | — |
| desktop-1600 | clients | `page.header-strip` | `position` | `relative` | `static` | — |
| desktop-1600 | clients | `page.header-strip` | `gap` | `0px 10px` | `12px` | +12.0 |
| desktop-1600 | clients | `page.header-strip` | `rowGap` | `0px` | `12px` | +12.0 |
| desktop-1600 | clients | `page.header-strip` | `marginBottom` | `0px` | `32px` | +32.0 |
| desktop-1600 | clients | `page.header-strip` | `rect.h` | `40px` | `73px` | +33.0 |
| desktop-1600 | discovery | `shell.rail.group-first` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | discovery | `shell.rail.group-first` | `rect.w` | `174.5px` | `220px` | +45.5 |
| desktop-1600 | discovery | `shell.rail.items` | `active.backgroundColor` | `rgba(31, 60, 239, 0)` | `rgb(31, 60, 239)` | — |
| desktop-1600 | discovery | `page.title` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | discovery | `page.title` | `rect.w` | `269.8px` | `1250.9px` | +981.1 |
| desktop-1600 | discovery | `page.header-strip` | `display` | `flex` | `grid` | — |
| desktop-1600 | discovery | `page.header-strip` | `alignItems` | `normal` | `center` | — |
| desktop-1600 | discovery | `page.header-strip` | `gridTemplateColumns` | `none` | `1250.92px 0px` | — |
| desktop-1600 | discovery | `page.header-strip` | `position` | `relative` | `static` | — |
| desktop-1600 | discovery | `page.header-strip` | `gap` | `0px 10px` | `12px` | +12.0 |
| desktop-1600 | discovery | `page.header-strip` | `rowGap` | `0px` | `12px` | +12.0 |
| desktop-1600 | discovery | `page.header-strip` | `marginBottom` | `0px` | `32px` | +32.0 |
| desktop-1600 | discovery | `page.header-strip` | `rect.h` | `45px` | `63px` | +18.0 |
| desktop-1600 | creators | `shell.rail.group-first` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | creators | `shell.rail.group-first` | `rect.w` | `174.5px` | `220px` | +45.5 |
| desktop-1600 | creators | `shell.rail.items` | `active.backgroundColor` | `rgba(31, 60, 239, 0)` | `rgb(31, 60, 239)` | — |
| desktop-1600 | creators | `page.title` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | creators | `page.title` | `rect.w` | `112.2px` | `1070.9px` | +958.7 |
| desktop-1600 | creators | `page.header-strip` | `display` | `flex` | `grid` | — |
| desktop-1600 | creators | `page.header-strip` | `alignItems` | `normal` | `center` | — |
| desktop-1600 | creators | `page.header-strip` | `gridTemplateColumns` | `none` | `1070.92px 180px` | — |
| desktop-1600 | creators | `page.header-strip` | `position` | `relative` | `static` | — |
| desktop-1600 | creators | `page.header-strip` | `gap` | `0px 10px` | `12px` | +12.0 |
| desktop-1600 | creators | `page.header-strip` | `rowGap` | `0px` | `12px` | +12.0 |
| desktop-1600 | creators | `page.header-strip` | `marginBottom` | `0px` | `32px` | +32.0 |
| desktop-1600 | creators | `page.header-strip` | `rect.h` | `40px` | `73px` | +33.0 |
| desktop-1600 | lists | `shell.rail.group-first` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | lists | `shell.rail.group-first` | `rect.w` | `174.5px` | `220px` | +45.5 |
| desktop-1600 | lists | `shell.rail.items` | `active.backgroundColor` | `rgba(31, 60, 239, 0)` | `rgb(31, 60, 239)` | — |
| desktop-1600 | lists | `page.title` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | lists | `page.title` | `rect.w` | `56.1px` | `1070.9px` | +1014.8 |
| desktop-1600 | lists | `page.header-strip` | `display` | `flex` | `grid` | — |
| desktop-1600 | lists | `page.header-strip` | `alignItems` | `normal` | `center` | — |
| desktop-1600 | lists | `page.header-strip` | `gridTemplateColumns` | `none` | `1070.92px 180px` | — |
| desktop-1600 | lists | `page.header-strip` | `position` | `relative` | `static` | — |
| desktop-1600 | lists | `page.header-strip` | `marginBottom` | `0px` | `32px` | +32.0 |
| desktop-1600 | lists | `page.header-strip` | `rect.h` | `40px` | `73px` | +33.0 |
| desktop-1600 | requests | `shell.rail.group-first` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | requests | `shell.rail.group-first` | `rect.w` | `174.5px` | `220px` | +45.5 |
| desktop-1600 | requests | `page.title` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | requests | `page.title` | `rect.w` | `233px` | `1128.4px` | +895.4 |
| desktop-1600 | requests | `page.header-strip` | `display` | `flex` | `grid` | — |
| desktop-1600 | requests | `page.header-strip` | `alignItems` | `normal` | `center` | — |
| desktop-1600 | requests | `page.header-strip` | `gridTemplateColumns` | `none` | `1128.38px 122.547px` | — |
| desktop-1600 | requests | `page.header-strip` | `position` | `relative` | `static` | — |
| desktop-1600 | requests | `page.header-strip` | `marginBottom` | `0px` | `32px` | +32.0 |
| desktop-1600 | requests | `page.header-strip` | `rect.h` | `40px` | `63px` | +23.0 |
| desktop-1600 | recipients | `shell.rail.group-first` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | recipients | `shell.rail.group-first` | `rect.w` | `174.5px` | `220px` | +45.5 |
| desktop-1600 | recipients | `page.title` | `overflowX` | `visible` | `hidden` | — |
| desktop-1600 | recipients | `page.title` | `rect.w` | `125.9px` | `1250.9px` | +1125.0 |
| desktop-1600 | recipients | `page.header-strip` | `display` | `flex` | `grid` | — |
| desktop-1600 | recipients | `page.header-strip` | `alignItems` | `normal` | `center` | — |
| desktop-1600 | recipients | `page.header-strip` | `gridTemplateColumns` | `none` | `1250.92px 0px` | — |
| desktop-1600 | recipients | `page.header-strip` | `position` | `relative` | `static` | — |
| desktop-1600 | recipients | `page.header-strip` | `marginBottom` | `0px` | `32px` | +32.0 |

_…and 130 more._

## Accepted deviations

Differences we chose. Listed so they are never re-reported as defects, and so
the reason survives the person who made the decision.

- `shell.rail.group-first` `color`: rgba(31, 60, 239, 0.36) → rgba(31, 60, 239, 0.85)
  — deliberate contrast fix (app/globals.css:333) -- their 0.36 measures 1.89:1 and fails WCAG AA; ours is retuned to pass, and we are not reverting an accessibility fix for parity
- `shell.rail.group-first` `borderTopColor`: rgba(31, 60, 239, 0.36) → rgba(31, 60, 239, 0.85)
  — deliberate contrast fix (app/globals.css:333) -- their 0.36 measures 1.89:1 and fails WCAG AA; ours is retuned to pass, and we are not reverting an accessibility fix for parity
- `shell.rail.group-first` `borderBottomColor`: rgba(31, 60, 239, 0.36) → rgba(31, 60, 239, 0.85)
  — deliberate contrast fix (app/globals.css:333) -- their 0.36 measures 1.89:1 and fails WCAG AA; ours is retuned to pass, and we are not reverting an accessibility fix for parity

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
| desktop-1600 | campaigns | `shell.rail` | `paddingTop` | `20px` | `0px` |
| desktop-1600 | campaigns | `shell.rail` | `paddingRight` | `10px` | `0px` |
| desktop-1600 | campaigns | `shell.rail` | `paddingBottom` | `20px` | `0px` |
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
| desktop-1600 | activations | `shell.rail` | `paddingTop` | `20px` | `0px` |
| desktop-1600 | activations | `shell.rail` | `paddingRight` | `10px` | `0px` |
| desktop-1600 | activations | `shell.rail` | `paddingBottom` | `20px` | `0px` |
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
| desktop-1600 | calendar | `shell.rail` | `paddingTop` | `20px` | `0px` |
| desktop-1600 | calendar | `shell.rail` | `paddingRight` | `10px` | `0px` |
| desktop-1600 | calendar | `shell.rail` | `paddingBottom` | `20px` | `0px` |
| desktop-1600 | calendar | `shell.rail` | `paddingLeft` | `10px` | `0px` |
| desktop-1600 | calendar | `shell.rail.items` | `flexWrap` | `wrap` | `nowrap` |
| desktop-1600 | calendar | `shell.rail.items` | `justifyContent` | `flex-start` | `normal` |
| desktop-1600 | calendar | `shell.rail.items` | `alignItems` | `normal` | `center` |
| desktop-1600 | calendar | `shell.rail.items` | `gap` | `0px 10px` | `10px` |
| desktop-1600 | calendar | `shell.rail.items` | `rowGap` | `0px` | `10px` |
| desktop-1600 | calendar | `shell.rail.items` | `marginBottom` | `0px` | `8px` |
| desktop-1600 | clients | `shell.rail` | `justifyContent` | `space-between` | `normal` |

_…and 105 more._

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
