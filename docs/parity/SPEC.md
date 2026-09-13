# CreatorCore — measured layout spec

What the reference product does, per landmark, per viewport, taken from
`2026-09-13T19-01-43`. This file plus `reference/` is the whole point of the
harness: **the CreatorCore login is never needed again to answer a layout question.**

## `page.header-strip`

| viewport | rect | display | flexDirection | justifyContent | alignItems | gap | gridTemplateColumns | fontSize | fontWeight | letterSpacing | color | backgroundColor | borderRadius |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop-1440 | 1136.5×36 @262,23.5 | `flex` | `row` | `space-between` | `normal` | `10px` | `none` | `16px` | `400` | `normal` | `rgb(0, 0, 0)` | `rgba(0, 0, 0, 0)` | `0px` |
| desktop-1600 | 1263×40 @291,26 | `flex` | `row` | `space-between` | `normal` | `10px` | `none` | `16px` | `400` | `normal` | `rgb(0, 0, 0)` | `rgba(0, 0, 0, 0)` | `0px` |
| mobile-390 | 348×45 @21,31 | `flex` | `row` | `space-between` | `normal` | `10px` | `none` | `16px` | `400` | `normal` | `rgb(0, 0, 0)` | `rgba(0, 0, 0, 0)` | `0px` |
| tablet-768 | 726×45 @21,31 | `flex` | `row` | `space-between` | `normal` | `10px` | `none` | `16px` | `400` | `normal` | `rgb(0, 0, 0)` | `rgba(0, 0, 0, 0)` | `0px` |

## `shell.rail`

| viewport | rect | display | flexDirection | justifyContent | alignItems | gap | gridTemplateColumns | fontSize | fontWeight | letterSpacing | color | backgroundColor | borderRadius |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop-1440 | 216×873 @9,13.5 | `flex` | `column` | `space-between` | `normal` | `12px normal` | `none` | `16px` | `400` | `normal` | `rgb(0, 0, 0)` | `rgb(255, 255, 255)` | `20px` |
| desktop-1600 | 240×970 @10,15 | `flex` | `column` | `space-between` | `normal` | `12px normal` | `none` | `16px` | `400` | `normal` | `rgb(0, 0, 0)` | `rgb(255, 255, 255)` | `20px` |
| mobile-390 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| tablet-768 | _NOT_APPLICABLE_ | | | | | | | | | | | | |

## `shell.rail.items`

| viewport | rect | display | flexDirection | justifyContent | alignItems | gap | gridTemplateColumns | fontSize | fontWeight | letterSpacing | color | backgroundColor | borderRadius |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop-1440 | 198×36 @18,100.6 | `flex` | `row` | `flex-start` | `normal` | `0px 10px` | `none` | `16px` | `400` | `normal` | `rgb(0, 0, 0)` | `rgb(31, 60, 239)` | `10px` |
| desktop-1600 | 220×40 @20,111.8 | `flex` | `row` | `flex-start` | `normal` | `0px 10px` | `none` | `16px` | `400` | `normal` | `rgb(0, 0, 0)` | `rgb(31, 60, 239)` | `10px` |
| mobile-390 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| tablet-768 | _NOT_APPLICABLE_ | | | | | | | | | | | | |

## `shell.rail.group-first`

| viewport | rect | display | flexDirection | justifyContent | alignItems | gap | gridTemplateColumns | fontSize | fontWeight | letterSpacing | color | backgroundColor | borderRadius |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop-1440 | 157×16.9 @18,76.5 | `block` | `row` | `normal` | `normal` | `normal` | `none` | `15px` | `400` | `normal` | `rgba(31, 60, 239, 0.36)` | `rgba(0, 0, 0, 0)` | `0px` |
| desktop-1600 | 174.5×18.8 @20,85 | `block` | `row` | `normal` | `normal` | `normal` | `none` | `15px` | `400` | `normal` | `rgba(31, 60, 239, 0.36)` | `rgba(0, 0, 0, 0)` | `0px` |
| mobile-390 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| tablet-768 | _NOT_APPLICABLE_ | | | | | | | | | | | | |

## `list.rows`

| viewport | rect | display | flexDirection | justifyContent | alignItems | gap | gridTemplateColumns | fontSize | fontWeight | letterSpacing | color | backgroundColor | borderRadius |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop-1440 | _UNRESOLVED_ | | | | | | | | | | | | |
| desktop-1600 | 200×40 @730,97.8 | `flex` | `row` | `space-between` | `normal` | `0px 8px` | `none` | `16px` | `400` | `normal` | `rgb(0, 0, 0)` | `rgb(243, 245, 253)` | `10px` |
| mobile-390 | _UNRESOLVED_ | | | | | | | | | | | | |
| tablet-768 | 233.3×56.5 @26,327.8 | `flex` | `row` | `flex-start` | `normal` | `0px 8px` | `none` | `16px` | `400` | `normal` | `rgb(0, 0, 0)` | `rgb(242, 244, 251)` | `10px` |

## `page.title`

| viewport | rect | display | flexDirection | justifyContent | alignItems | gap | gridTemplateColumns | fontSize | fontWeight | letterSpacing | color | backgroundColor | borderRadius |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop-1440 | 124.2×27 @262,28 | `block` | `row` | `normal` | `normal` | `normal` | `none` | `24px` | `700` | `normal` | `rgb(31, 60, 239)` | `rgba(0, 0, 0, 0)` | `0px` |
| desktop-1600 | 138.1×30 @291,31 | `block` | `row` | `normal` | `normal` | `normal` | `none` | `24px` | `700` | `normal` | `rgb(31, 60, 239)` | `rgba(0, 0, 0, 0)` | `0px` |
| mobile-390 | 103.5×22.5 @21,42.3 | `block` | `row` | `normal` | `normal` | `normal` | `none` | `18px` | `700` | `normal` | `rgb(31, 60, 239)` | `rgba(0, 0, 0, 0)` | `0px` |
| tablet-768 | 103.5×22.5 @21,42.3 | `block` | `row` | `normal` | `normal` | `normal` | `none` | `18px` | `700` | `normal` | `rgb(31, 60, 239)` | `rgba(0, 0, 0, 0)` | `0px` |

## `page.primary-action`

| viewport | rect | display | flexDirection | justifyContent | alignItems | gap | gridTemplateColumns | fontSize | fontWeight | letterSpacing | color | backgroundColor | borderRadius |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop-1440 | 162×36 @1069.1,23.5 | `flex` | `row` | `center` | `center` | `8px` | `none` | `18px` | `400` | `normal` | `rgb(255, 255, 255)` | `rgb(31, 60, 239)` | `10px` |
| desktop-1600 | 180×40 @1188,26 | `flex` | `row` | `center` | `center` | `8px` | `none` | `18px` | `400` | `normal` | `rgb(255, 255, 255)` | `rgb(31, 60, 239)` | `10px` |
| mobile-390 | _UNRESOLVED_ | | | | | | | | | | | | |
| tablet-768 | _UNRESOLVED_ | | | | | | | | | | | | |

## `campaign.rail`

| viewport | rect | display | flexDirection | justifyContent | alignItems | gap | gridTemplateColumns | fontSize | fontWeight | letterSpacing | color | backgroundColor | borderRadius |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop-1440 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| desktop-1600 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| mobile-390 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| tablet-768 | _NOT_APPLICABLE_ | | | | | | | | | | | | |

## `campaign.rail.items`

| viewport | rect | display | flexDirection | justifyContent | alignItems | gap | gridTemplateColumns | fontSize | fontWeight | letterSpacing | color | backgroundColor | borderRadius |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop-1440 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| desktop-1600 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| mobile-390 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| tablet-768 | _NOT_APPLICABLE_ | | | | | | | | | | | | |

## `settings.nav`

| viewport | rect | display | flexDirection | justifyContent | alignItems | gap | gridTemplateColumns | fontSize | fontWeight | letterSpacing | color | backgroundColor | borderRadius |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| desktop-1440 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| desktop-1600 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| mobile-390 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
| tablet-768 | _NOT_APPLICABLE_ | | | | | | | | | | | | |
