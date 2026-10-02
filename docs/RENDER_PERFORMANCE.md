# Render discipline

Measured, not assumed. Everything below has a number next to it or is enforced by
a test; nothing here is a rule for its own sake.

## The one rule

**A list row is a memoised component, not inline JSX inside the page's `.map()`.**

A list page holds a lot of state that has nothing to do with any individual row:
a sync in flight, a refresh ticking its progress, a modal opening, every
keystroke in a filter box. React re-renders the page for each of those, and
inline JSX inside a `.map()` has no identity to compare, so every row re-renders
with it. The campaign posts grid draws 25 tiles of roughly 60 elements apiece,
and none of them had changed.

```tsx
// no
{rows.map((row) => (
  <div key={row.id}>{/* 140 lines */}</div>
))}

// yes
{rows.map((row) => <PostGridCard key={row.id} post={row} campaignId={id} />)}
//                 ^ export default memo(PostGridCardImpl)
```

`memo` is easy to add and silently easy to lose. These three defeat it while the
page keeps rendering correctly:

- an inline arrow as a prop (`onSelect={() => pick(row.id)}`) — wrap it in
  `useCallback` and pass the row's id back out, or pass nothing and let the row
  own its own link;
- an object or array literal as a prop (`style={{…}}`, `cols={[…]}`) — hoist it
  to a module constant or `useMemo` it;
- a component type created during a parent's render — React treats it as a new
  type and remounts the whole subtree, bypassing every memo below it.

`__tests__/unit/components/renderDiscipline.test.tsx` asserts the posts tile is
actually skipped when unrelated page state changes, and that it is still a
`memo` object rather than a bare function. Both fail if the memo is removed
(checked by removing it).

## Typed filters use `useDeferredValue`

A text box that filters a client-side list re-runs the filter and re-renders the
result on every keystroke, in the same task as the keypress. `useDeferredValue`
splits that: the character paints first, the list catches up after.

```tsx
const [creatorSearch, setCreatorSearch] = useState("");
const deferredSearch = useDeferredValue(creatorSearch);
// the input stays bound to creatorSearch; only the derived list reads the deferred one
```

Keep the input itself on the immediate value. Deferring what a field *displays*
is how a text box starts dropping characters.

Filters that go to the server debounce into the URL instead — `/creators` does
this at 350ms — and do not need either.

## A context provider's `value` is memoised

`<Ctx.Provider value={{ a, b }}>` hands every consumer a new value on each
render of the provider. Providers sit high in the tree, so that is a re-render
of everything that calls the hook, for a value that has not changed. `useMemo`
it against the fields it carries. `useState` setters are already stable and do
not belong in the dependency list.

## Measuring before changing anything

The interactive cost is a long-task total, not a feeling. In the browser:

```js
window.__lt = [];
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); })
  .observe({ entryTypes: ['longtask'] });
// …interact…
window.__lt.reduce((a, b) => a + Math.max(0, b - 50), 0);   // blocking time
```

Baseline for the campaign posts tab, dev server, 88 posts / 25 tiles, twelve
keystrokes into the creator filter (2026-09-15): one long task of 66–81ms,
16–31ms of it blocking. A dev build is several times slower than production, so
treat these as an upper bound and as the number a change has to beat, not as a
user-facing figure.

## Page budgets

Every main screen is held to published budgets, measured in a production build,
not a dev server:

| Metric | Budget | Source |
|---|---|---|
| LCP | ≤ 2.5 s | Core Web Vitals "good", web.dev/articles/vitals |
| INP | ≤ 200 ms | Core Web Vitals "good" |
| CLS | ≤ 0.1 | Core Web Vitals "good" |
| FCP | ≤ 1.8 s | web.dev/articles/fcp |
| TTFB | ≤ 0.8 s | web.dev/articles/ttfb |
| TBT | ≤ 200 ms | Lighthouse, mobile "good" |
| Long task while interacting | ≤ 50 ms | RAIL, web.dev/articles/rail |

Lab profile: CPU slowed 4x, 40 ms RTT, 10 Mbps, bodies brotli-compressed the
way Vercel's edge serves them, 1440×900, in all three themes. The data is
synthetic and production-sized: an 800-post campaign, a 300-creator list, 1,700
creators and 480 campaigns.

```bash
# a throwaway Postgres, never a Neon branch
docker run -d --name perf-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=outreach_e2e -p 55432:5432 postgres:16
export DATABASE_URL=postgresql://postgres:postgres@localhost:55432/outreach_e2e?schema=public
npx prisma db push && SEED_ALLOW=1 npx prisma db seed
PERF_DATABASE_URL=$DATABASE_URL node scripts/perf/seed.mjs
npm run build && PORT=3011 npm start &       # with DATABASE_URL still pointing at it
node scripts/perf/gzproxy.mjs 3021 3011 &
PORT=3021 THEME=light node scripts/perf/bench.mjs   # also THEME=dark, THEME=creatorcore
```

`bench.mjs` needs `e2e/fixtures/.auth.json`, which any Playwright run writes.
TTFB from a local server says nothing about production; measure that against
the deployment.

## Nothing is styled below a `:has()`

A rule whose subject sits under a `:has()` — `X:has(.y) > *`, `X:has(.y) .z`, or
any of Tailwind's group/peer "has" variants — together with any `:has()`
whose argument can match deep in the tree, makes Chrome restyle the whole
document on every DOM insertion. On the 300-row list (9,318 elements) one
appended node cost a 15 ms style recalculation (20 ms in creatorcore) with
five such rules present, and 0.2 ms without them. Each rule alone measured
0.2 ms, so none looked guilty on its own. At 4x CPU that held `/lists/[id]`
at over a second of blocking time.

Put a class on the element instead (`.rsp-page.cc-bleed-page`, not
`.rsp-page:has(> .cc-bleed)`). A `:has()` that styles its own subject is fine.
`__tests__/unit/styles/broadHasSelectors.test.ts` fails on either form.

## Long tables defer off-screen rows

`.cc-row-deferred` (`content-visibility: auto`) skips layout and paint for
rows outside the viewport. Two traps, both measured:

- `contain-intrinsic-size` sizes the **content** box. Padding and border are
  added on top, so give it the row's height minus its vertical padding and
  border, or the scroll height drifts by thousands of pixels.
- Paint containment clips anything drawn outside the row. Use it only on rows
  that open no popover or menu inside themselves.

## Charts cap their categories

Recharts measures every tick label in the DOM. The campaign's Creator
Performance bar chart drew a bar pair per creator — 240 bars and 120 tick
labels on a 120-creator campaign — and took a single 290 ms task at 4x CPU. It now draws the top 10 by views and
says so under its title.
