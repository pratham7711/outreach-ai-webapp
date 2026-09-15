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
