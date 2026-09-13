# CreatorCore parity — the durable reference

**The point of this directory: nobody ever has to log into CreatorCore again to
answer a question about how CreatorCore looks.** Every screen, at four widths, is
here as a screenshot *and* as measurements — and the measurements, not the
screenshots, are the spec.

## What is here

| path | what it is |
|---|---|
| `reference/<viewport>/<surface>.full.png` | CreatorCore, whole page |
| `reference/<viewport>/<surface>.viewport.png` | CreatorCore, above the fold |
| `reference/<viewport>/<surface>.landmarks.json` | **the actual spec** — every measured property of every landmark on that screen |
| `ours/<viewport>/<surface>.*` | the same three files for our app in the `creatorcore` theme |
| `contact-sheet.html` | browsable grid: every CreatorCore surface × every viewport |
| `contact-sheet-ours.html` | the same grid for ours |
| `report.html` | **their screen beside ours**, worst-first, with that pair's differences underneath |
| `REPORT.md` | the diff in text: headline counts, where differences concentrate, every high-severity row |
| `SPEC.md` | CreatorCore's layout numbers per landmark per viewport, in one table |
| `findings.json` | every difference, machine-readable |

Viewports: `desktop-1600` `desktop-1440` `tablet-768` `mobile-390`.

## How to read it

Read in this order, and do not skip the first step:

1. **Harness health.** A landmark that did not resolve is not a landmark that
   agrees. Any surface under 60% resolution is reported as *not measured* rather
   than as clean. `docs/PARITY_LOOP.md:181` is blunt about why: two of the three
   findings in the first sweep were bugs in the sweep.
2. **`report.html`.** If a pair looks like two unrelated screens, the *pairing*
   is wrong (`scripts/creatorcore/parity/pairs.mjs`) and every number under it is
   noise. Check that before believing a single row.
3. **Then the differences**, high severity first.

## Why the numbers are trustworthy

- **One function measures both sides.** `probe.mjs` is `page.evaluate`'d
  identically on CreatorCore and on us; only the resolver differs (`side: "ref"`
  vs `side: "ours"`). A measurement bug therefore cannot flatter one side.
- **Neither side's selectors appear in the diff.** The join key is a landmark id.
  Theirs resolves by text anchor, painted ancestor, geometry or sibling run —
  CreatorCore is Bubble-generated and has no `<nav>`, no roles and no stable
  classes. Ours resolves by an explicit `data-parity` attribute, because we own
  our markup. Not `data-testid`: a test selector moving must never silently break
  a measurement.
- **One context per viewport, never a resize.** A resized page keeps its resize
  history and reports different numbers than a fresh load at the same width.
- **Absence is distinguished from failure.** `NOT_APPLICABLE` (the rail is
  removed from the DOM below 1024, not hidden), `MISSING_OURS` (a thing we have
  deliberately not built), `NO_REFERENCE` (ours with no counterpart) and
  `UNRESOLVED` (the probe failed) are four different verdicts, not one.

## Reproducing

```bash
npm run parity            # everything: both captures, promote, report
npm run parity:capture    # CreatorCore only  (needs ~/.config/creatorcore/secrets.env)
npm run parity:capture:ours   # ours only     (needs a dev server; default :3011)
npm run parity:promote    # raw -> this directory
npm run parity:report     # the diff
```

The reference account is **read-only**; nothing in this harness writes to it.
Handles, emails and money are redacted in-page *before* the screenshot, and the
redaction is verified: the surface is measured before and after, and any
redaction that moved a landmark has its screenshot **withheld** rather than
published as a layout reference that would be wrong.

Our side needs no login flow either — it encodes a NextAuth JWT locally, the same
trick `e2e/fixtures/auth.setup.ts` uses, so no credentials are ever typed into a
page.

## What the measurements actually showed

The single most useful result in this directory is not a list of differences, it
is a **model**: above the desktop breakpoint, CreatorCore's layout is a fixed
proportion of the viewport, not a set of px values with breakpoints.

| thing | 1600px | 1440px | ratio | ratio at 1440 |
|---|---|---|---|---|
| rail width | 240 | 216 | 15.000% | 15.000% |
| rail left inset | 10 | 9 | 0.625% | 0.625% |
| content origin x | 291 | 262 | 18.19% | 18.19% |
| primary action | 180×40 | 162×36 | 11.25% × 2.5% | 11.25% × 2.5% |
| header strip y | 26 | 23.5 | 1.625% | 1.632% |
| header strip height | 40 | 36 | 2.5% | 2.5% |

Every one of those is 0.9 at 1440 against 1600, and 1440/1600 is 0.9. A fixed px
value can only be right at one screen width, which is why our fixed-px shell
matched at 1600 and drifted at 1440 before this.

**Below the breakpoint the scaling stops.** The primary action measures a flat
180×40 at both 768 and 390. A floor cannot produce that — a 180px floor would
also clamp the 162 at 1440 — so it is a breakpoint, and the `vw` values live
behind one.

**Two things are NOT ratios**, and both were got wrong by assuming they were:

- **The page title is a flat px size**: 24px/700 with 30px leading on dashboard
  screens and 20px/25px on campaign screens, identical at 390, 768, 1440 and
  1600. An earlier pass read it as fluid between 18px@768 and 24px@1440; the
  18px came from two surfaces where the resolver had landed on a section
  sub-heading rather than the page title.
- **The primary action's type is flat too**: 18px/400 at every desktop width,
  while the box around it scales.

### The scaling is geometric, not a type ramp

The 0.9 above holds even where the CSS says it should not. On `/campaigns` at
1440 the page title's computed `font-size` is `24px` and its computed
`line-height` is `30px`, yet its rect is **27px tall** — 30 x 0.9. A box cannot
be shorter than its own line-height by layout; it can only be *drawn* smaller.
So the ratio is not a fluid type scale at all: the whole desktop shell is
rendered at one geometric scale, and every computed value underneath stays at
its 1600 figure.

That resolves the apparent contradiction in the section above — "everything is a
ratio" and "the title is flat px" are both true, of different things. The
computed values are flat; the pixels they are painted at are ratios.

(Measured: the ratio, the computed values, and the disagreement between them.
The mechanism — a transform or zoom on an ancestor — is inferred: each landmark
records `transform: none` on *itself*, and the probe does not walk ancestors.)

**What that means for us.** We reproduce the geometry ratio with percentage
shell tokens (rail 15%, content origin 18.19%), which is the right call and is
what makes the shell match at both widths. We do not reproduce the *type*
riding that ratio, and should not: scaling text geometrically is what their
build does, not something to copy. Expect our type to read 1-3px larger than
theirs at 1440 by measurement while looking correct, and do not "fix" it by
adding a fluid ramp to the creatorcore theme.

### Settings is a second shell, and it does not scale at all

Their settings screens are not the dashboard shell with different content. Every
settings surface reports `shell.rail: NOT_APPLICABLE` and a `settings.nav`
instead, and nothing in it moves between 1600 and 1440:

| | settings 1600 | settings 1440 | dashboard 1600 | dashboard 1440 |
|---|---|---|---|---|
| left nav | x=12 y=125 w=251 | **identical** | rail x=10 w=240 | x=9 w=216 |
| content origin x | 291 | **291** | 291 | 262 |
| header strip | y=16 h=72 w=1293 | y=16 h=72 w=**1133** | y=26 h=40 | y=23.5 h=36 |
| page title | x=307 y=40.8 18px/400 | **identical** | x=291 y=31 24px/700 | x=262 y=28 |

The strip's width absorbs the entire 160px difference and nothing else changes.
So settings is a fixed left column plus a fluid content column, while the
dashboard is one proportional shell — two different layout models in the same
product.

Three consequences, all of them measured:

- **The page title has three styles, not two.** Dashboard 24px/700, campaign
  20px/700, settings **18px/400** — and the settings one is near-black
  `rgb(16, 24, 40)` where the other two are the brand indigo `rgb(31, 60, 239)`.
  Identical on all five settings surfaces (account, branding, general,
  integrations, notifications), each resolved with `candidateCount: 1`.
  This is implemented: the rail publishes `data-shell="settings"` and
  `:root.creatorcore .cc-shell-root:has(...)` re-points the three tokens.
- **The settings title is inset 16px from the content origin** (307 vs 291),
  because it sits inside the padded white card that `page.header-strip` resolves
  to on these surfaces. The 13 x 6 `page.header-strip` findings on settings
  (16px padding, 10px radius, white background) are therefore *correct
  measurements of a different element*, not a resolver bug — the settings shell
  genuinely has no 40px strip.
- **`settings-team` and `settings-stories` are still resolver bugs.** Their
  titles resolve to the far-right action button (x=1390 "Invite New User",
  x=1380 "Add New Account"), which sits 2px above the real title. Fixed in
  `probe.mjs` with `maxLeftRatio: 0.5`, but the stored landmark JSON above
  predates that fix and still carries the wrong values.

### Below the desktop breakpoint both shells agree

At 768 and 390 the page title is **18px/400 with 22.5px leading on every
surface**, dashboard and settings alike, at x=21 and x=20. The three desktop
title styles collapse to one.

## Findings that were the harness, not the product

Kept here because each one cost a cycle, and each one *looked* exactly like a
real difference:

- **561 contrast failures at exactly 1:1.** The design critic's first run
  reported that almost every nav label in the campaign rail was invisible. The
  labels measure **7.12:1** in the browser. `bgBehind()` was resolving a node's
  ground with the test `depth < n.depth && x <= n.x && y <= n.y`, which any node
  in a *preceding branch* satisfies -- so the solid-indigo brand chip at the top
  of the rail was scored as the background of every indigo label below it. The
  fix is a real containment test (the candidate must also *end* after the node
  ends). **A ratio of exactly 1:1 is the signature of this class of bug** -- ink
  scored against itself -- and the critic now reports it as
  `harness/ground-unresolved` rather than as a contrast failure, because a false
  contrast finding sends someone to change a colour that was fine.

- **Rail item colour.** Reported as "theirs black, ours blue" on 20 screens. The
  series probe was reading the row wrapper, whose own `color` is the inherited
  black, while the visible label is a child painted in the brand blue. The
  screenshot settles it: both are blue. The probe now measures the element that
  owns the label text.
- **Rail item state.** The probe read paint from `items[0]`, and on their
  `/campaigns` the first row is the SELECTED one while ours is not — so a state
  difference was reported as a colour difference on every screen at once. Paint
  is now measured per item and split into `rest` and `active`.
- **`page.primary-action`.** Our side resolved `page-actions > *:first-child`,
  which on 6 of 13 screens is a count badge, a range picker or a filter chip.
  The primary action now declares itself with `data-cc-slot="primary"`.
- **`list.rows`.** Our selector included `.cc-table-row`, which is also the class
  on the rail's user button — so a 216px sidebar control was being compared
  against their 1177px content rows. The selector is now scoped to `main`.
- **`page.header-strip`.** On 29 campaign surfaces the geometry probe grabbed a
  white content card instead of the 40px strip. It is now anchored on the title.
- **A cold Turbopack cache, reported as a parity win.** Capturing our side
  against a server started on a freshly deleted `.next/dev` served Next's dev
  error overlay (`ENOENT ... build-manifest.json`) on 27 of 39 surfaces. That
  overlay returns 200, has a DOM and screenshots cleanly, so the capture logged
  **"156 ok / 0 failed"** and the headline difference count *fell by 614*. The
  only tell in the numbers was the resolution rate: 13% ours against 84%
  reference. Warm every route with an authenticated request, one at a time,
  before capturing — warmed serially they all answered 200 in ~1.5s. The report
  now prints a **Harness health** table above the differences naming every
  unmeasured surface and which side was short, so this cannot be silent again.

## Known limits

- **Read the Harness health section of `REPORT.md` before any number in it.** A
  difference count is only meaningful against the number of surfaces actually
  compared; a capture that half-failed produces a smaller count, not a better
  product.
- `list.rows` resolves on 57 of 172 reference surfaces. Some of those misses are
  real (an empty campaign tab has no rows), but not all — the generic sibling-run
  detector does not find CreatorCore's campaign tables. **This is the largest
  remaining harness gap and it is a probe limitation, not a product difference.**
- `page.primary-action` is `UNRESOLVED` where a screen simply has no primary
  button. The probe cannot currently tell "absent" from "not found".
- The ours-side campaign fixture is whichever campaign appears first in the list,
  so it can differ between runs.
