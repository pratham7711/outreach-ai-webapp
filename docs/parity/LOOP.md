# The working loop — CreatorCore theme parity

**Goal.** In the `creatorcore` theme only, our app matches CreatorCore on
*behaviour, layout and colour* — every page section, the sidebar, every div,
every button placement, and every default. If their campaign detail opens on
Posts rather than Performance, ours opens on Posts in that theme. The `light`
and `dark` themes are not in scope and must not move.

**Why a loop and not a checklist.** The first four passes of this work were
eyeball-and-fix, and three of the findings turned out to be bugs in the sweep
rather than in the product. A loop that measures, scores and records is the
only version of this that can tell a fix from a coincidence — and the only one
that can prove it is converging rather than moving problems around.

---

## One iteration

```bash
PORT=3009 npm run dev                                  # once, in its own shell
node scripts/creatorcore/parity/loop.mjs --viewport desktop-1600
```

That is the whole command. It runs seven steps and appends one line to
`docs/parity/history.jsonl`.

| # | step | asks | writes |
|---|---|---|---|
| 1 | **warm** | is every route compiled? | — |
| 2 | **capture** | what does ours render? | `scripts/creatorcore/out/parity-ours/<runId>/` |
| 3 | **measure** | do the landmarks measure the same? | `docs/parity/REPORT.md` |
| 4 | **structure** | does every *div* match — presence, order, box, paint? | `docs/parity/structure/<vp>.md` |
| 5 | **critique** | is it good design, by named laws? | `docs/parity/critique/<vp>.md` |
| 6 | **review** | what does it *look* like, side by side? | `docs/parity/review/<vp>/*.sbs.png` |
| 7 | **score** | did this iteration converge? | `docs/parity/history.jsonl` |

### 1 — warm (never skip this)

Every route is fetched serially before anything is measured.

A cold Turbopack cache does **not** fail loudly. It serves Next's runtime-error
overlay **with HTTP 200** — a real DOM that screenshots cleanly, so the capture
logs `156 ok / 0 failed` and the report shows a large improvement. That
happened: high-severity findings appeared to fall 800 → 186 while 27 of 39
surfaces were rendering an error page. The only tell was the landmark
resolution rate (ours 13%, reference 84%), which is why step 7 puts *measured*
above every other number and step 3 prints a **Harness health** section above
the results.

### 2 — capture

One `BrowserContext` per viewport, freshly loaded. `page.setViewportSize()` is
banned in this directory by a preflight grep: resizing a live page instead of
reloading gives different numbers, because responsive groups keep resize
history.

### 3 — measure (the landmark diff)

Ten declared landmarks per surface, resolved by `data-parity` on our side and
by four text/geometry strategies on theirs, measured with **one** probe
function serialised into both pages. Same code both sides, so a measurement bug
cannot flatter one of them. Every measurement is relative to its `origin`
landmark, never the viewport — our nav has 20 items to their 14, so every
absolute coordinate below the fold is off by a number that means nothing.

Answers *"is the rail 240 wide, is the title 24/700 indigo"*.

### 4 — structure (the div diff)

The landmarks cannot answer *"is the primary button before or after the
secondary one"*, *"is there a card around the filter row"*, *"do we render a
control they do not"*. That is what the eye actually sees, and it is what
`structdiff.mjs` reports, by aligning the two structural trees the probe
collects under every resolved landmark.

Alignment is by `(role, normalised text)` first and position second — the only
pairing that survives two unrelated DOMs. Their Bubble markup and our React
markup agree on almost nothing except what a node **is** and what it **says**.
Digits are normalised to `#` so a fixture difference (`512` vs `8` on a count
chip) never reads as a structural one.

Six verdicts:

| kind | means |
|---|---|
| `MISSING` | they render it, we do not |
| `EXTRA` | we render it, they do not |
| `ORDER` | both render it, in a different sequence |
| `MOVED` | same node, >4px from the landmark origin |
| `RESIZED` | same node, >4px box difference |
| `RESTYLED` | same node, different background / ink / radius / border |

### 5 — critique (the design layer)

A diff can only say *different from theirs*. It is silent on the 22 screens of
ours with no CreatorCore counterpart, silent when both products are wrong, and
silent on **why** a difference matters. `critic.mjs` fills that gap by applying
named laws to the same structural tree — see `heuristics.mjs`, where each rule
cites the law it comes from, because a finding that cannot be traced to a
principle is an opinion with a line number.

| family | law | what it can actually check |
|---|---|---|
| `jakob/*` | **Jakob's Law** — people expect your product to work like the others they already use | the reference tree *is* the convention: primary-action position, controls we add that they lack, a cluster on the opposite side of the row |
| `fitts/*` | **Fitts's Law** + WCAG 2.5.8 | target below 24×24, adjacent targets with no clear space |
| `hicks/*` | **Hick's Law** | more than seven equally-weighted peer actions in one cluster |
| `gestalt/*` | **Gestalt** — alignment, proximity, common region | a child off the stack's single alignment edge; gaps between groups no larger than gaps within one |
| `nielsen/*` | **#4** consistency and standards, **#6** recognition over recall, **#8** aesthetic and minimalist design | one action painted two ways on one screen; an unlabelled icon control; clipped text |
| `wcag/*` | **WCAG 1.4.3** | contrast below AA, with alpha composited onto the real ground rather than the declared one |

Findings are grouped **by rule, not by surface**: one broken recipe repeated on
25 screens is one fix, and a per-surface list buries it among 25 apparent
problems. Every rule carries a `fix` naming the token or class that moves it.

### 6 — review (the side-by-side)

Our app is driven live per surface, screenshotted, and composited against the
stored reference shot with a shared 100px ruler. The reference shots are 2×
device-scale and ours are 1×, so both are resized to the viewport width before
compositing — otherwise every measurement in the image is off by a factor of
two and every judgement made from it is wrong.

This is the step that catches what no probe does: the reference rail is a
**floating card inset from the viewport on all sides**, and no landmark
property says so.

### 7 — score

Four numbers, deliberately **not** collapsed into one:

```
surfaces measured   156   (not measured 60)
property  high      759
structural high     ...  of ...
design    high      ...  of ...
```

A single index invites trading a real regression in one dimension against a
cosmetic win in another — which is exactly what happened invisibly once already.
`measured` is printed first because every number under it is meaningless when
it is low, and the loop prints a warning when it falls.

---

## Between iterations — how a fix is chosen

Fix in this order, and stop at the first one that is non-empty:

1. **Harness health.** Any surface reporting `NOT_MEASURED`, `UNRESOLVED` or
   `AMBIGUOUS` is fixed before any product change. A finding on a surface that
   did not render is not a finding.
2. **`structdiff` `MISSING` / `EXTRA` at high severity.** A control that is
   absent or surplus outweighs any amount of drift on the controls that are
   present.
3. **`critic` `high`.** Contrast failures, unlabelled controls, sub-24px
   targets and alignment breaks. These are floors, not preferences.
4. **`jakob/*`.** Placement and order against the product the user already
   knows.
5. **`ORDER` → `MOVED` → `RESIZED` → `RESTYLED`**, in that order. Geometry
   before paint: a node in the wrong place with the right colour still reads as
   wrong, and the reverse usually does not.
6. **Property drift** from `REPORT.md`.

### How a fix is made

The rules that make the loop converge rather than oscillate:

- **Token re-point, not property set.** A theme block may only re-point a token
  that already exists in the base `:root`. A theme block that declares a
  property is a rule some other theme now has to fight.
- **Theme blocks are `:root.creatorcore`, never bare `.creatorcore`.** Base
  `:root` is (0,1,0); the theme block must be (0,2,0) or it loses to the base
  block further down the file. This trap has already cost one silent failure —
  the rail stayed 264px while the theme said 240.
- **No `!important`, ever.** `globals.css` carries no `@layer`, so every rule
  in it is unlayered and already beats every layered rule regardless of
  specificity. The only thing that beats it is an inline `style` attribute — so
  when a rule loses, the fix is to remove the inline style, not to shout.
- **Inline custom properties are allowed; inline layout properties are not.**
  `style={{ "--cc-tab-ink": color }}` keeps the value dynamic and the cascade
  winnable. `style={{ padding: 8 }}` does neither.
- **`order:` is free.** Adding `order: var(--cc-order-*, 0)` to a slot-bearing
  child is a no-op today and lets a theme re-sequence a cluster with no JSX
  edit. Only on whole clusters, or where visual order genuinely should equal
  tab order — CSS reorders paint, never focus.
- **Prove it with computed style, not a screenshot.** Turbopack's dev CSS cache
  does not invalidate on a `globals.css` edit, even across a server restart:
  `rm -rf .next/dev`, restart, re-warm, then read the computed value.

### What counts as done

- `structdiff` high = 0 for the surface.
- `critic` high = 0 for the surface.
- The side-by-side composite shows no difference a person can name.
- `light` and `dark` are unchanged — `e2e/layout-geometry.spec.ts` and
  `e2e/contrast.spec.ts` are the evidence, not an opinion.

---

## The reference archive

The reference is captured **once** and committed. It is someone else's
read-only product; re-capturing it every iteration would be both rude and
noisy, and it changes on their release schedule rather than ours.

```bash
node scripts/creatorcore/parity/capture.mjs          # needs the login; read-only
node scripts/creatorcore/parity/promote.mjs          # curate into docs/parity/reference/
```

Run it when *their* product actually changes. A re-baseline is a reviewed act:
a baseline change means the reference moved, which is news — never "the test
was failing so I updated the numbers".

**Known gap:** the committed reference run predates the structural tree probe,
so `structdiff` reports `NO_TREES` for every surface until it is re-captured.
The tool says so loudly rather than reporting zero findings, because zero
findings and a probe that did not run are indistinguishable in a count.

---

## Related

- `docs/parity/README.md` — what the numbers mean and which of them have been
  wrong before.
- `docs/PARITY_LOOP.md` — the older **data** parity loop for one campaign
  (values, labels, broken images). Different question, same discipline.
- `docs/parity/SPEC.md` — the measured reference spec.
