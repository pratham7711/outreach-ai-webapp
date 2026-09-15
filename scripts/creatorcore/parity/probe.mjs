/**
 * The measurement function. Serialised into the page and run IDENTICALLY on
 * both sides -- only the resolvers differ. One code path means a measurement
 * bug cannot flatter one side of the diff.
 *
 * Replaces the 31-property set in cc-sidebar-spec.mjs, which is fine for a nav
 * rail and blind to everything that decides a grid: no grid-template-columns,
 * no separate row/column gap, no flex-grow/shrink/basis, no min/max-width, no
 * overflow-x.
 */
export const PROBE = (args) => {
  // SIDE is the only thing that differs between the two runs. The property
  // extraction, the derived measurements and the hit-test below are byte-for-byte
  // the same code on the reference and on us -- which is the point: a measurement
  // bug cannot flatter one side of a diff it computed with one function.
  const { landmarks, shellHint, side = "ref" } = args;

  const GROUPS = {
    box: ["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
          "padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
          "margin", "marginTop", "marginRight", "marginBottom", "marginLeft",
          "boxSizing", "overflow", "overflowX", "overflowY"],
    container: ["display", "flexDirection", "flexWrap", "alignItems", "justifyContent",
                "gap", "rowGap", "columnGap", "gridTemplateColumns", "gridTemplateRows",
                "gridAutoFlow", "gridTemplateAreas"],
    item: ["flexGrow", "flexShrink", "flexBasis", "alignSelf", "justifySelf",
           "order", "gridArea", "position", "top", "right", "bottom", "left"],
    type: ["fontSize", "fontWeight", "lineHeight", "letterSpacing", "textTransform",
           "textAlign", "whiteSpace", "textOverflow", "fontStyle"],
    paint: ["color", "backgroundColor", "backgroundImage", "borderRadius",
            "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
            "borderTopColor", "borderBottomColor", "boxShadow", "opacity"],
    layer: ["zIndex", "visibility", "transform"],
  };
  const ALL = Object.values(GROUPS).flat();

  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  };
  const style = (el) => {
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of ALL) o[p] = cs[p];
    return o;
  };
  const visible = (el) => {
    if (!el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const ownText = (el) =>
    [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(" ");

  /**
   * Bubble ships BOTH responsive groups and hides one. A plain visibility check
   * happily measures the hidden twin and reports beautiful, fictional
   * agreement -- so a landmark must also be the thing actually painted at its
   * own centre point.
   */
  const hitTest = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.x + Math.min(r.width / 2, 40);
    const cy = r.y + Math.min(r.height / 2, 20);
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return "offscreen";
    const hit = document.elementFromPoint(cx, cy);
    if (!hit) return "nothing";
    return el.contains(hit) || hit.contains(el) ? "ok" : "occluded";
  };

  const textWalk = (pred) => {
    if (!document.body) throw new Error("no document.body -- page is mid-navigation");
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const out = [];
    let n;
    while ((n = w.nextNode())) {
      const t = n.textContent.trim();
      if (t && pred(t) && n.parentElement && visible(n.parentElement)) out.push(n.parentElement);
    }
    return out;
  };

  // ---- resolvers -------------------------------------------------------
  /* True when the landmark denotes a RUN of elements rather than one element.
     The reference side says so by strategy; our side says so with `series: true`
     alongside its selector, because we resolve the same run by attribute. */
  const isSeries = (spec) => spec.strategy === "series" || spec.series === true;

  /* The floor for calling a run a run. The REFERENCE side has always had one --
     `siblingRun.minCount`, 3 -- but our side had none, so a `series: true`
     selector that matched a single element resolved as a healthy OK and its one
     box was compared against their 5-row run.

     MEASURED 2026-09-14 on settings/team: our selector matches exactly ONE
     `.cc-table-row` (the seeded org has one team member) and a sweep for any
     repeated row-shaped box in `main` returns nothing at all, while the
     reference resolves a 5-row series with pitch 61. The harness then reported
     `pitch`, `count`, `rowHeight`, padding, display and fontWeight as drift --
     13 findings comparing a one-row table against a five-row one. That is not a
     measurement, and none of it was actionable.

     A run that is shorter than the run minimum is UNRESOLVED, which routes it to
     harness health where "we could not measure this" belongs, instead of to
     drift where it reads as a difference we could fix. Same floor on both sides,
     because one probe evaluated identically on both sides is the whole point. */
  const SERIES_MIN = 3;
  const seriesFloor = (spec) => spec.siblingRun?.minCount ?? SERIES_MIN;

  const resolvers = {
    /* The header strip is not reliably findable by position: on their campaign
       screens a white content card sits in the same band and a geometry probe
       picks it instead (measured: 29 of 45 surfaces resolved a 72-100px card
       rather than the 40px strip, which then reported a white background and a
       10px radius as "drift" against our transparent one).

       Defining it structurally instead -- the nearest ancestor of the TITLE that
       spans the content column -- cannot pick a sibling card, because the title
       is inside the strip by definition. */
    /* The first content in NORMAL FLOW below an already-resolved landmark.
       Added 2026-09-14 to settle `page.header-strip :: marginBottom`, which two
       ad-hoc scans had answered differently: one said their content resumes
       31.8px below the strip, the other found nothing at all. Both were guessing
       a predicate ("is it painted?", "does it own a text node?") and each guess
       landed on a different DEPTH in the two DOMs -- a Bubble wrapper on their
       side, a content block on ours.

       So this asks the only question that survives two unrelated DOMs: what is
       the TOPMOST thing below the header, ignoring depth entirely. Dumping every
       candidate on both sides first showed the answer is stable and obvious
       (their "4 Active Campaigns" caption, our toolbar row) as long as two
       things are excluded:

         - out-of-flow elements. Measured: before this was excluded, our
           /campaigns resolved an OPEN FILTER POPOVER at 140.5 and reported the
           gap as 24 instead of 32.
         - narrow fragments, via minWidth -- an icon or a chip is not where the
           content column resumes.

       Identical spec on both sides, deliberately: a resolver that differs per
       side is what produced the two contradictory answers. */
    belowLandmark(spec, ctx) {
      const anchor = ctx.resolved[spec.below];
      if (!anchor || !anchor.rect) return [];
      const top0 = anchor.rect.y + anchor.rect.h;
      /* "Not the sidebar" is a STRUCTURAL question, and two geometric answers
         to it were both wrong, each in its own direction:

         (a) `shell.rail`'s right edge -- shell.rail is NOT_APPLICABLE on the
             settings shell, so the `?? 0` fallback turned the guard OFF and
             this landmark resolved to a 240px box at x=10, the sidebar. It
             stayed hidden only because our page wrapper sat 0.5px above the
             rail's inner group until a 16px content shift handed the rail the
             win. A guard that degrades to "no guard" rather than "cannot
             measure" is the bug, not the number it produced.
         (b) the anchor's own left edge -- this over-corrected. MEASURED on
             their `requests`: their content block starts at x=270 while the
             header starts at 291, because the list full-bleeds 21px to the
             left. A left-edge test throws that real content away and lands
             10px lower on a narrower box.

         So neither edge is the boundary; the containing SUBTREE is. A
         candidate must live inside the anchor's parent -- that excludes the
         sidebar (a different subtree) and keeps a negatively-margined
         full-bleed child (the same subtree), with no bleed allowance to
         guess. If the anchor has no parent element there is nothing to scope
         to, and the landmark reports UNRESOLVED rather than falling back. */
      const scope = anchor.__el?.parentElement;
      if (!scope) return [];
      /* The floor stays ABSOLUTE and permissive. MEASURED 2026-09-14: raising
         it to 0.8x the anchor made the probe skip their 200px record-count
         caption ("200 Creators", "19 Lists") and land on the filter bar below
         it, turning a MISSING ELEMENT into a 18.8-31.8px spacing delta -- and
         a spacing delta invites padding the header, which would fake the
         caption's height with margin. The caption IS their first content and
         it sits flush at 0, which is what our 0px matches. When the two sides
         resolve structurally different elements the answer is "not
         comparable", not a narrower resolver; report.mjs enforces that. */
      const minW = spec.minWidth ?? 200;
      const win = spec.window ?? 400;
      let best = null, bestTop = Infinity;
      for (const el of scope.querySelectorAll("*")) {
        if (anchor.__el === el || anchor.__el.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < minW || r.height < 4) continue;
        if (r.top < top0 - 0.5 || r.top > top0 + win) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        if (cs.position === "absolute" || cs.position === "fixed") continue;
        if (r.top < bestTop) { bestTop = r.top; best = el; }
      }
      return best ? [best] : [];
    },

    ancestorOf(spec, ctx) {
      const anchor = ctx.resolved[spec.of];
      let el = anchor && anchor.__el;
      if (!el) return [];
      const maxH = spec.maxHeight ?? 200;
      const minW = innerWidth * (spec.minWidthRatio ?? 0.55);
      for (let i = 0; i < (spec.hops ?? 6) && el && el !== document.body; i++) {
        el = el.parentElement;
        if (!el) break;
        const r = el.getBoundingClientRect();
        if (r.width >= minW && r.height <= maxH) return [el];
      }
      return [];
    },

    /* Ours only. We own this markup, so the landmark is declared outright with
       data-parity rather than inferred from text and box shape. Not data-testid:
       a test selector moving must never silently break a measurement. */
    selector(spec) {
      const all = [...document.querySelectorAll(spec.css)].filter((e) => visible(e));
      /* `pick` exists for one honest reason: the reference resolves exactly one
         primary action per screen, and two of our screens carry two primary
         buttons in the header row. Reporting AMBIGUOUS there would hide a
         landmark that is genuinely present; picking the rightmost names the
         counterpart of their single blue button and says so out loud. */
      if (spec.pick === "last" && all.length > 1) return [all[all.length - 1]];
      if (spec.pick === "first" && all.length > 1) return [all[0]];
      return all;
    },
    anchorWalk(spec) {
      const anchors = textWalk((t) => t === spec.anchorText);
      if (!anchors.length) return [];
      if (!spec.ancestor) return [anchors[0]];
      const out = [];
      for (const a of anchors) {
        for (let el = a; el && el !== document.body; el = el.parentElement) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          // The two rails are painted completely differently -- the dashboard
          // rail is a floating WHITE inset card, the campaign rail a full-bleed
          // panel in the brand blue rgb(31,60,239) at (0,0). A white-only
          // predicate cannot find the second one.
          const transparent =
            cs.backgroundColor === "rgba(0, 0, 0, 0)" || cs.backgroundColor === "transparent";
          const whiteOk = !spec.ancestor.bgIsWhite || cs.backgroundColor === "rgb(255, 255, 255)";
          const paintedOk = !spec.ancestor.bgPainted || !transparent;
          if (whiteOk && paintedOk && r.width >= spec.ancestor.minWidth && r.width <= spec.ancestor.maxWidth) {
            out.push(el);
            break;
          }
        }
      }
      return out;
    },
    paintedAncestor(spec) {
      // A fixed label list does not survive 45 surfaces: the primary action is
      // "New Campaign", "New Creator", "New Payout", "Export Data", "Add Funds"…
      // so the pattern is matched instead, and the topmost/rightmost match in
      // the header band wins.
      const re = spec.anchorPattern ? new RegExp(spec.anchorPattern) : null;
      const anchors = textWalk((t) =>
        (re && re.test(t)) || (spec.anchorTextAny || []).some((x) => t === x || t.startsWith(x))
      ).filter((el) => {
        const r = el.getBoundingClientRect();
        return spec.maxTop == null || r.y <= spec.maxTop;
      }).sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x);
      const out = [];
      for (const a of anchors) {
        let el = a;
        for (let i = 0; i < (spec.hops ?? 4) && el && el !== document.body; i++, el = el.parentElement) {
          const cs = getComputedStyle(el);
          if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") {
            out.push(el);
            break;
          }
        }
      }
      return out;
    },
    geometry(spec, ctx) {
      const railRight = ctx.resolved["shell.rail"]?.rect
        ? ctx.resolved["shell.rail"].rect.x + ctx.resolved["shell.rail"].rect.w
        : 0;
      if (spec.biggestTextInBand) {
        const b = spec.biggestTextInBand;
        // TOPMOST qualifying text, not the largest. Measured: on
        // /settings?tab=General the largest text in the band is a section
        // heading ("Tags & Statuses", 20px, y=136) while the actual page title
        // is smaller and higher ("General Settings", 18px, y=41). Sorting by
        // font size picks the section heading on every settings surface.
        let best = null;
        for (const el of document.querySelectorAll("*")) {
          if (!visible(el)) continue;
          const t = ownText(el);
          // A glyph box can carry a huge font-size and no readable text: the
          // first run picked a 15px-wide element at fontSize 50 over the real
          // heading. Require real words and a real box.
          if (!/[A-Za-z0-9]{2,}/.test(t)) continue;
          const r = el.getBoundingClientRect();
          if (r.y > b.maxTop || r.width < (b.minWidth ?? 40)) continue;
          if (b.rightOfRail && r.x < railRight - 1) continue;
          // A page title starts where the content starts, never in the action
          // zone at the far right. Without this, "topmost" picked the primary
          // action on settings-team ("Invite New User", x=1390, y=32) and
          // settings-stories ("Add New Account", x=1380, y=34) -- both sit two
          // pixels ABOVE the real title, so being topmost was enough to win.
          if (b.maxLeftRatio != null && r.x > innerWidth * b.maxLeftRatio) continue;
          const fs = parseFloat(getComputedStyle(el).fontSize);
          if (fs < (b.minFontSize ?? 16)) continue;
          if (!best || r.y < best.y - 2 || (Math.abs(r.y - best.y) <= 2 && fs > best.fs)) {
            best = { el, fs, y: r.y };
          }
        }
        return best ? [best.el] : [];
      }
      const out = [];
      for (const el of document.querySelectorAll("*")) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (spec.maxTop != null && r.y > spec.maxTop) continue;
        const minW = spec.minWidthRatio != null ? innerWidth * spec.minWidthRatio : spec.minWidth;
        if (minW != null && r.width < minW) continue;
        if (spec.maxHeight != null && r.height > spec.maxHeight) continue;
        if (spec.rightOfRail && r.x < railRight - 1) continue;
        out.push(el);
      }
      // Innermost wins: ancestors satisfy the same predicate.
      return out.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height).slice(0, 1);
    },
    series(spec, ctx) {
      const railRight = ctx.resolved["shell.rail"]?.rect
        ? ctx.resolved["shell.rail"].rect.x + ctx.resolved["shell.rail"].rect.w
        : 0;
      let scope = document.body;
      if (spec.within) {
        // If the parent landmark did not resolve, this one CANNOT resolve.
        // Falling back to document.body is what produced a "resolved" nav of
        // 2 items at x=0 y=0 w=1600 h=1000 with pitch 0 on campaign pages --
        // a confident, meaningless number. An unresolvable scope is reported,
        // never substituted.
        const parent = ctx.resolved[spec.within];
        if (!parent || parent.status !== "OK" || !parent.__el) return [];
        scope = parent.__el;
      }
      let items = [];
      if (spec.itemText) {
        // Resolve each label to its ROW (the ancestor that spans the scope's
        // width), then keep only the longest run of rows sharing one parent.
        //
        // Taking every matching label regardless of parent is what produced a
        // nonsense pitch of [144, 223.75, 48, 208.75, 36.75] on the first run:
        // the nav is several sibling groups with headers between them, so a
        // hand-picked text list measures the gaps BETWEEN groups as if they
        // were row spacing. The true pitch, 48px, was one entry in that list.
        const scopeW = scope.getBoundingClientRect().width;
        const rows = [];
        for (const t of spec.itemText) {
          const hit = [...scope.querySelectorAll("*")].find((el) => visible(el) && ownText(el) === t);
          if (!hit) continue;
          let row = hit;
          for (let p = hit; p && p !== scope; p = p.parentElement) {
            if (p.getBoundingClientRect().width >= scopeW * 0.75) { row = p; break; }
          }
          rows.push(row);
        }
        const groups = new Map();
        for (const r of rows) {
          const key = r.parentElement;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(r);
        }
        let best = [];
        for (const g of groups.values()) if (g.length > best.length) best = g;
        items = best.sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y);
      } else if (spec.siblingRun) {
        // Generic: a parent whose visible children are equal-width and evenly
        // pitched IS a list, whatever it contains. The campaign-specific text
        // markers this replaced found nothing on /creators and /payouts, which
        // is why most surfaces resolved only 5 of 7 landmarks.
        const runs = [];
        for (const parent of document.querySelectorAll("div")) {
          const kids = [...parent.children].filter(visible);
          if (kids.length < (spec.siblingRun.minCount ?? 3)) continue;
          const rects = kids.map((k) => k.getBoundingClientRect());
          if (rects.some((r) => r.width < (spec.siblingRun.minWidth ?? 200) || r.height < 20)) continue;
          const w0 = rects[0].width;
          if (!rects.every((r) => Math.abs(r.width - w0) < 2)) continue;
          const tops = rects.map((r) => r.y).sort((a, b) => a - b);
          const d = [];
          for (let i = 1; i < tops.length; i++) d.push(tops[i] - tops[i - 1]);
          if (!d.length || Math.max(...d) - Math.min(...d) > 3) continue;
          /* The run must actually STACK. Even-pitch alone is satisfied trivially
             by a horizontal run -- four table-header cells side by side all share
             one `y`, so every gap is 0 and the variance test reads that as
             perfectly even. Measured on the reference's /campaigns: a 4-cell,
             200px-wide header row ("Campaign Status", pitch 0) won the match over
             the real content list and was reported against our 1262.9px rows.
             A list advances down the page; a header row does not. */
          if (Math.max(...d) < 8) continue;
          if (spec.siblingRun.rightOfRail && rects[0].x < railRight - 1) continue;
          runs.push({ kids, count: kids.length, width: w0 });
        }
        /* Rank by WIDTH first, then count. Ranking by count alone picked "the
           longest run of siblings anywhere in the document", which is not the
           same thing as "the content list": measured on the reference, it
           resolved a run exactly 200px wide -- sitting on the minWidth floor --
           while this file's own note at landmarks.mjs records their real content
           rows as ~1177px. That single mis-resolution produced 22 of the 62 real
           differences in the last report, including rect.w 200 vs 1262.9 and
           rect.h 40 vs 86, which are two different elements rather than any
           drift. A content list spans the content column; a sidebar widget with
           more items does not, so width is the discriminating signal and count
           is only the tie-break. */
        runs.sort((a, b) => (b.width - a.width) || (b.count - a.count));
        items = runs.length ? runs[0].kids : [];
      } else if (spec.repeatedTextMarkers) {
        const cands = [...scope.querySelectorAll("div")].filter((el) => {
          if (!visible(el)) return false;
          const t = el.innerText || "";
          return spec.repeatedTextMarkers.every((m) => t.includes(m));
        });
        const seen = new Set();
        for (const el of cands.sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)) {
          const key = (el.innerText || "").slice(0, 40);
          if (seen.has(key)) continue;
          seen.add(key);
          items.push(el);
        }
        if (items.length < (spec.minCount ?? 2)) items = [];
      }
      return items;
    },
  };

  /** Derived numbers -- these are what the PRD tables are actually made of. */
  const derive = (els) => {
    if (els.length < 2) return {};
    const rects = els.map((e) => e.getBoundingClientRect()).sort((a, b) => a.y - b.y);
    const tops = rects.map((r) => r.y);
    const pitches = [];
    for (let i = 1; i < tops.length; i++) pitches.push(+(tops[i] - tops[i - 1]).toFixed(2));
    // gapEffective catches a gap achieved via margin-bottom, which is literally
    // what app/globals.css:493 does -- a `gap` read alone reports 0 there.
    const gaps = [];
    for (let i = 1; i < rects.length; i++) {
      gaps.push(+(rects[i].y - (rects[i - 1].y + rects[i - 1].height)).toFixed(2));
    }
    const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);
    return {
      count: els.length,
      pitch: med(pitches),
      pitchAll: pitches,
      gapEffective: med(gaps),
      rowHeight: med(rects.map((r) => +r.height.toFixed(2))),
    };
  };

  /** The >85%-width horizontal band scan that proved "zero dividers". */
  const countDividers = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    let n = 0;
    for (const c of el.querySelectorAll("*")) {
      const cs = getComputedStyle(c);
      const cr = c.getBoundingClientRect();
      if (cr.width < r.width * 0.85) continue;
      const thin = cr.height <= 2;
      const borders = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0;
      if (thin || borders) n++;
    }
    return n;
  };

  /**
   * MEASURED: CreatorCore has THREE shells, not one.
   *   dashboard -- global rail, contains "Campaigns & Reporting"
   *   campaign  -- the rail BECOMES the campaign (Overview/Creators/Posts/...)
   *   settings  -- its own nav ("My Settings"/"Account"), no rail at all
   * A landmark that belongs to another shell is NOT_APPLICABLE: a distinct,
   * non-failing status. Reporting it as UNRESOLVED made every settings and
   * campaign surface look broken at 4/7 when it was in fact complete.
   */
  const detectShell = () => {
    const body = document.body.innerText || "";
    if (/\bMy Settings\b/.test(body) && !/Campaigns & Reporting/.test(body)) return "settings";
    if (/Campaigns & Reporting/.test(body)) return "dashboard";
    return "campaign";
  };
  // The caller knows the shell from the URL and passes it in. DOM sniffing is
  // only a fallback, because below 1024px the rail is in a drawer and invisible
  // to a body-text probe -- which mislabelled every surface at 768px.
  const shell = shellHint || detectShell();

  const ctx = { resolved: {}, shell };
  const results = {};

  for (const lm of landmarks) {
    // Below its breakpoint a landmark can be legitimately absent. MEASURED at
    // 768px: CreatorCore does not hide the rail, it REMOVES it from the DOM
    // ("Campaigns & Reporting" is not in body text at all), and the page title
    // drops from 24px@x=291 to 18px@x=21. Reporting that as UNRESOLVED makes a
    // correct responsive design look like three broken landmarks.
    if (lm.minViewportWidth && innerWidth < lm.minViewportWidth) {
      results[lm.id] = {
        id: lm.id, status: "NOT_APPLICABLE", shell,
        note: `absent below ${lm.minViewportWidth}px; viewport is ${innerWidth}px`,
      };
      ctx.resolved[lm.id] = results[lm.id];
      continue;
    }
    if (lm.shells && !lm.shells.includes(shell)) {
      results[lm.id] = {
        id: lm.id, status: "NOT_APPLICABLE", shell,
        note: `landmark belongs to shell(s) ${lm.shells.join("/")}; this surface is "${shell}"`,
      };
      ctx.resolved[lm.id] = results[lm.id];
      continue;
    }
    const spec = lm[side];
    /* A landmark we have deliberately not built is a PRODUCT finding, not a
       failed resolution. Reporting it as UNRESOLVED would put a real structural
       gap into the harness-health bucket, where it reads as a broken probe and
       drags the surface below the health gate -- so the diff would then refuse
       to measure everything else on that screen because of it. */
    if (spec && spec.knownAbsent) {
      results[lm.id] = {
        id: lm.id, status: "MISSING_OURS", side, shell, note: spec.knownAbsent,
      };
      ctx.resolved[lm.id] = results[lm.id];
      continue;
    }
    if (!spec) {
      results[lm.id] = { id: lm.id, status: "NO_SPEC", side, shell };
      continue;
    }
    let els = [];
    let error = null;
    try {
      els = resolvers[spec.strategy] ? resolvers[spec.strategy](spec, ctx) : [];
    } catch (e) {
      error = String(e.message || e);
    }

    const status = error
      ? "ERROR"
      : els.length === 0
        ? "UNRESOLVED"
        : isSeries(spec) && els.length < seriesFloor(spec)
          ? "UNRESOLVED"
          : els.length > 1 && !isSeries(spec)
            ? "AMBIGUOUS"
            : "OK";
    const primary = els[0] || null;

    const entry = {
      id: lm.id,
      status,
      error,
      resolvedBy: spec.strategy,
      candidateCount: els.length,
    };

    if (primary) {
      entry.rect = rect(primary);
      entry.style = style(primary);
      entry.hit = hitTest(primary);
      entry.text = (primary.innerText || "").trim().slice(0, 120);
      entry.truncated = primary.scrollWidth > primary.clientWidth + 1;
      entry.dividerCount = countDividers(primary);
      entry.__el = primary;
      if (isSeries(spec)) {
        entry.derived = derive(els);
        /* A run of nav rows is not one style, it is two: the rest style that
           most rows wear and the selected style that exactly one wears. Reading
           the paint off items[0] measures whichever of the two happens to sit
           first, and that differs by surface -- their /campaigns rail starts on
           the SELECTED "Campaigns" row while ours starts on an unselected
           "Dashboard". Comparing those two reports a colour difference that is
           really a state difference, on every screen at once.

           So the paint is measured per item and split: `rest` is the style the
           plurality of rows share, `active` is the odd one out. Those are the
           two things that must match the reference, and they are comparable
           because each side is asked the same question. */
        /* borderTopColor/borderBottomColor are deliberately absent: with a 0px
           border they only ever echo `currentColor`, so diffing them restated
           the colour finding twice and tripled the count of a single fact. */
        const PAINT = ["color", "backgroundColor", "fontWeight", "borderRadius",
                       "boxShadow", "opacity"];
        /* Measure what is SEEN, not what the row element happens to compute.
           CreatorCore's nav rows are a Bubble wrapper whose own `color` is the
           inherited black while the visible label is a child painted in the
           brand blue -- so reading the row reported "their labels are black,
           ours are blue" on 20 screens, and the screenshot says both are blue.
           A colour nobody can see is not a colour worth diffing.

           So: `color` and `fontWeight` come from the element that actually owns
           the label text, and `backgroundColor` from the row or the nearest
           ANCESTOR that actually paints. */
        /* FIRST text-bearing descendant, not the last. A row reads
           "Name / email / Active / Pay", so the last one is the Pay BUTTON and
           its white ink was being reported as the row's text colour -- measured
           on the reference's /recipients as white text on a white ground, which
           is the signature of a paint lookup landing on the wrong element, never
           a real defect. labelInset a few lines below already takes the first;
           these two now agree. */
        const labelOf = (row) => {
          const own = (e) => [...e.childNodes].some(
            (n) => n.nodeType === 3 && n.textContent.trim());
          return [...row.querySelectorAll("*")].find((e) => visible(e) && own(e)) || row;
        };
        /* Alpha from BOTH serialisations. Chrome returns a color-mix() as
           `color(srgb 0.8 0.185 0.151 / 0.5)`, never rgba(), so the old
           `/,\s*0\s*\)$/` test could not see a transparent one and called it
           painted. This is the same trap that has now cost this repo five
           findings-sets; the rule is to parse every form the browser can emit. */
        const alphaOf = (bg) => {
          if (!bg || bg === "transparent") return 0;
          const fn = /^color\(\s*srgb\s+([^)]+)\)/i.exec(bg);
          if (fn) {
            const parts = fn[1].split("/");
            return parts[1] !== undefined ? parseFloat(parts[1]) : 1;
          }
          const m = /^rgba?\(([^)]+)\)/.exec(bg);
          if (!m) return 0;
          const q = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
          if (q.length < 3) return 0;
          return q.length > 3 ? q[3] : 1;
        };
        /* The row itself if it paints, otherwise its ANCESTORS -- never its
           descendants. A row's ground is what sits behind it; walking inward
           found the green rgb(45,196,128) "Active" status pill and reported it
           as the row background of every team row on the reference. Same lesson
           as the pg walk: a node that paints its own opaque background IS its
           own ground, and everything else is above it, not below. */
        const paintedOf = (row) => {
          for (let a = row, hops = 0; a && hops < 24; a = a.parentElement, hops++) {
            if (alphaOf(getComputedStyle(a).backgroundColor) > 0.5) return a;
          }
          /* NULL, not the row. 24 hops matches the pg walk above, and like pg
             this returns null rather than a value when nothing opaque is found.
             Falling back to the transparent row reports rgba(0,0,0,0) AS the
             ground -- measured on the reference's /recipients at an 8-hop cap,
             which then diffs "transparent" against our white and reads as a
             real colour difference. Transparent is not a ground; it is the
             answer "could not measure", and that must not become a finding. */
          return null;
        };
        const paintOf = (e) => {
          const lab = getComputedStyle(labelOf(e));
          const painted = paintedOf(e);
          const own = getComputedStyle(e);
          const o = {};
          for (const p of PAINT) o[p] = own[p];
          o.color = lab.color;
          o.fontWeight = lab.fontWeight;
          o.backgroundColor = painted ? getComputedStyle(painted).backgroundColor : null;
          return o;
        };
        entry.items = els.slice(0, 24).map((e) => ({
          rect: rect(e), text: (e.innerText || "").trim().slice(0, 60), paint: paintOf(e),
        }));
        const groups = new Map();
        for (const it of entry.items) {
          const k = JSON.stringify(it.paint);
          const g = groups.get(k) ?? { paint: it.paint, n: 0, texts: [] };
          g.n++;
          if (g.texts.length < 3) g.texts.push(it.text);
          groups.set(k, g);
        }
        const ordered = [...groups.values()].sort((a, b) => b.n - a.n);
        entry.states = {};
        /* The SELECTED row is the minority group that paints its own BACKGROUND
           differently from the resting rows -- not simply the smallest group.
           Measured on the reference's /campaigns, three groups exist: 4 resting
           rows (transparent, blue ink), "Campaigns" (SOLID blue, white ink) and
           a "Fan Pages / LEARN MORE" promo (transparent like rest, white ink).
           Two of those are groups of one, so "smallest" resolved by document
           order and returned the promo -- reporting their active nav background
           as transparent against our solid pill, 8 findings on a state that in
           fact matches ours exactly. Height cannot separate them (the promo is a
           40px row too; measured excluded=0). A selection is painted; emphasis
           only recolours ink. Falls back to the old rule when no minority group
           carries its own fill, so a rail that marks selection some other way
           still reports something rather than null. */
        const restPaint = ordered[0]?.paint ?? null;
        const minority = ordered.slice(1);
        const painted = minority.filter(
          (g) => restPaint && g.paint.backgroundColor !== restPaint.backgroundColor,
        );
        /* NO fallback. If no minority group paints its own background there is no
           selected row to compare, and null says exactly that -- which is what
           this block's original comment already promised ("null says so rather
           than inventing one from the runner-up") before the smallest-group rule
           quietly broke the promise. Measured on the reference's /discovery,
           /creators, /lists and /connections: two groups only, rest plus the
           promo, so falling back returned the promo and reported their active
           nav background as transparent against our solid pill on four more
           surfaces. A landmark that cannot be measured must not be reported as
           a difference. */
        const chosen = painted.length ? painted.sort((a, b) => a.n - b.n)[0] : null;
        Object.assign(entry.states, {
          activeBy: painted.length ? "own-background" : "none-painted",
          groupCount: ordered.length,
          rest: ordered[0]?.paint ?? null,
          restCount: ordered[0]?.n ?? 0,
          /* The selected row is the SMALLEST group, not merely the second one:
             a rail can carry a third style (a disabled row, a promoted row),
             and the selected one is the group of one. When every row paints the
             same -- a rail whose selection is drawn some other way -- there is
             no active style to compare, and null says so rather than inventing
             one from the runner-up. */
          active: chosen ? chosen.paint : null,
          activeText: chosen ? chosen.texts[0] : null,
          activeCount: chosen ? chosen.n : 0,
        });
        // labelInset: where the label text starts inside the row.
        const first = els[0];
        const label = [...first.querySelectorAll("*")].find((e) => visible(e) && ownText(e));
        if (label) entry.labelInset = +(label.getBoundingClientRect().x - first.getBoundingClientRect().x).toFixed(1);
      }
    }
    /* The dense structural inventory, taken under every landmark that resolved.
       The 10 landmarks answer "is the rail 240 wide"; they cannot answer "is
       the primary button before or after the secondary one", "is there a card
       around the filter row", or "do we render a control they do not" -- which
       is what the eye actually sees. `tree` is that list: every element under
       the landmark that paints, carries its own text, or is interactive.

       Cheap enough to ride along: capped per landmark, coordinates relative to
       the landmark so a shifted ancestor does not flag every descendant, and
       text normalised so two products' copy can be matched without the diff
       drowning in "Campaigns" vs "campaigns". */
    if (entry.status === "OK" && entry.__el) entry.tree = treeOf(entry.__el);
    ctx.resolved[lm.id] = entry;
    results[lm.id] = entry;
  }

  // Express every rect relative to its origin, and drop the element handles.
  for (const lm of landmarks) {
    const e = results[lm.id];
    delete e.__el;
    if (!e.rect) continue;
    const o = lm.origin ? results[lm.origin]?.rect : null;
    /* `below` is the gap between the origin's BOTTOM edge and this element's
       top edge. `dy` measures from the origin's top, so it carries the origin's
       own height inside it -- and that height is already its own finding
       (page.header-strip rect.h), so diffing dy double-counts it. For a
       landmark that exists to answer "how far below X does content start",
       `below` is the measurement and dy is not. */
    e.rel = o
      ? { dx: +(e.rect.x - o.x).toFixed(1), dy: +(e.rect.y - o.y).toFixed(1),
          below: +(e.rect.y - (o.y + o.h)).toFixed(1) }
      : null;
    e.origin = lm.origin ?? null;
  }

  /**
   * Every element under `root` that a person could point at, in document order.
   *
   * "Could point at" is three things, and an element needs only one: it paints
   * (a background, a border, or it IS an image), it carries its own text, or it
   * is interactive. A plain layout <div> with no paint and no text of its own
   * is skipped -- it is the two products' different bracketing of the same
   * pixels, and including it makes every diff a wall of noise.
   */
  function treeOf(root, cap = 220) {
    const R0 = root.getBoundingClientRect();
    const out = [];
    const seen = new Set();

    const ownText = (e) =>
      [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim();

    /* Digits are data, not layout: "512" vs "8" on a count chip is a fixture
       difference and must not read as a structural one. Case and whitespace go
       for the same reason. The raw text is kept alongside, for the report. */
    const norm = (t) =>
      t.toLowerCase().replace(/\d[\d,.$%kmb+]*/gi, "#").replace(/\s+/g, " ").trim().slice(0, 48);

    const roleOf = (e) => {
      const tag = e.tagName.toLowerCase();
      if (tag === "button" || e.getAttribute("role") === "button") return "button";
      if (tag === "a" && e.hasAttribute("href")) return "link";
      if (tag === "input") return e.type === "checkbox" || e.type === "radio" ? "toggle" : "input";
      if (tag === "select" || e.getAttribute("role") === "combobox") return "select";
      if (tag === "textarea") return "input";
      if (tag === "img") return "image";
      if (tag === "svg" || tag === "path") return "icon";
      if (/^h[1-6]$/.test(tag)) return "heading";
      return null;
    };

    /* What a screen reader would announce, and what a sighted user can read.
       The design critic needs both: an icon-only control with no name is a
       recognition failure whether or not it looks right. */
    const nameOf = (e) => {
      const lbl = e.getAttribute("aria-label") || e.getAttribute("title") || e.getAttribute("alt");
      if (lbl && lbl.trim()) return lbl.trim().slice(0, 48);
      const by = e.getAttribute("aria-labelledby");
      if (by) {
        const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
        if (t) return t.slice(0, 48);
      }
      const t = (e.textContent ?? "").trim();
      return t ? t.slice(0, 48) : "";
    };

    /* Clipped text. A truncated label is invisible to a geometry diff -- the box
       is the right size, the words are not there -- and is the single most
       common "reads as a bug" defect in a narrow rail. */
    const clipped = (e, cs) =>
      (cs.textOverflow === "ellipsis" || cs.overflow === "hidden" || cs.overflowX === "hidden") &&
      e.scrollWidth > e.clientWidth + 1;

    const paints = (cs) => {
      const bg = cs.backgroundColor;
      const hasBg = bg && bg !== "transparent" && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg);
      const bw = ["borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth"]
        .some((p) => parseFloat(cs[p]) > 0);
      const shadow = cs.boxShadow && cs.boxShadow !== "none";
      return hasBg || bw || shadow;
    };

    const walk = (el, depth) => {
      if (out.length >= cap) return;
      for (const e of el.children) {
        if (out.length >= cap) return;
        /* An <svg> is ONE icon, not a tree of shapes. lucide-react draws every
           glyph as paths and circles inside the svg, and roleOf() calls a <path>
           an "icon", so descending put 60 icon nodes in our rail against the
           reference's 15 -- 29 distinct boxes including 3.3x6.7 and 4.5x6, which
           are glyph strokes rather than anything a user can see. Across 21
           surfaces that is ~945 phantom EXTRA nodes, and it is what the first
           real structural run reported as 969 high-severity differences. The
           reference is Bubble: flat image icons with no sub-elements, so the
           inflation is one-sided and reads as "we render 1663 things they do
           not". Treat the svg as the leaf it already is visually. */
        const isSvg = e.tagName.toLowerCase() === "svg";
        const r = e.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) { if (!isSvg) walk(e, depth + 1); continue; }
        const cs = getComputedStyle(e);
        if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
        const t = ownText(e);
        const role = roleOf(e);
        const painted = paints(cs);
        if ((role || t || painted) && !seen.has(e)) {
          seen.add(e);
          out.push({
            role: role ?? (t ? "text" : "box"),
            text: norm(t),
            raw: t.slice(0, 40),
            depth,
            /* Relative to the landmark, and half-pixel rounded: Bubble emits
               sub-pixel boxes and an exact compare would flag every one. */
            x: +(r.x - R0.x).toFixed(1), y: +(r.y - R0.y).toFixed(1),
            w: +r.width.toFixed(1), h: +r.height.toFixed(1),
            bg: cs.backgroundColor, fg: cs.color,
            r: cs.borderRadius, bw: cs.borderTopWidth, bc: cs.borderTopColor,
            fs: cs.fontSize, fw: cs.fontWeight,
            d: cs.display, fd: cs.flexDirection, jc: cs.justifyContent, ai: cs.alignItems, gap: cs.gap,
            nm: nameOf(e), tr: clipped(e, cs), ta: cs.textAlign,
            /* The ground this node is actually painted on, resolved by walking
               the REAL DOM rather than reconstructed later from the captured
               tree. The critic's bgBehind() could only search nodes that made
               it into the tree, and the tree is capped at 220 per landmark and
               drops anything that neither paints nor carries text -- so in a
               long rail the painted ancestor was simply absent, bgBehind fell
               through to its white default, and the node was reported as
               `ground-unresolved` with ink and ground equal. The browser knows
               this answer exactly; there is no reason to infer it. Opaque means
               alpha > 0.5, matching bgBehind's own test, so a tint still defers
               to whatever is solid behind it. */
            pg: (() => {
              /* Starts at e ITSELF, not its parent -- bgBehind() starts its
                 scan at j = i for the same reason: a node that paints its own
                 opaque background IS its own ground. Starting at the parent
                 scored every such node against the surface behind it instead,
                 which took ground-unresolved from 1 to 92 and invented 12
                 contrast-below-aa highs on controls that were never broken. */
              for (let a = e, hops = 0; a && hops < 24; a = a.parentElement, hops++) {
                const b = getComputedStyle(a).backgroundColor || "";
                /* BOTH serialisations. A color-mix() background comes back as
                   `color(srgb 0.8 0.185 0.151)`, never rgb() -- and matching
                   only rgb() here walked straight past the rail's "9+" badge,
                   whose ground IS a color-mix, on up to white. That reported
                   29 white-on-white nodes. This is the third place in this
                   harness the same assumption has cost a false finding, after
                   heuristics.mjs and e2e/contrast.spec.ts. */
                let a4 = null;
                const fn = /^color\(\s*srgb\s+([^)]+)\)/i.exec(b);
                if (fn) {
                  const parts = fn[1].split("/");
                  a4 = parts[1] !== undefined ? parseFloat(parts[1]) : 1;
                } else {
                  const m = /^rgba?\(([^)]+)\)/.exec(b);
                  if (!m) continue;
                  const q = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
                  if (q.length < 3) continue;
                  a4 = q.length > 3 ? q[3] : 1;
                }
                if (a4 > 0.5) return b;
              }
              return null;
            })(),
            /* The box a pointer can actually hit, which is not always the
               control's own box. A <label> wrapping an input forwards its
               clicks to that input, so the target is the label. Our payout
               rows rely on exactly that -- a 16x16 checkbox inside a full-cell
               label with minHeight:32 -- and the code comment there says so:
               "the label takes the cell so the target is finger-sized without
               resizing the box". Measuring the input alone reported that
               deliberate fix as a WCAG 2.5.8 failure. Emitted separately
               rather than folded into w/h because w/h are what the structural
               diff compares, and a label-sized checkbox would then read as a
               geometry difference against the reference. */
            ...(() => {
              const lab = e.closest?.("label");
              if (!lab || lab === e) return {};
              const lr = lab.getBoundingClientRect();
              if (lr.width <= r.width && lr.height <= r.height) return {};
              return { hw: +lr.width.toFixed(1), hh: +lr.height.toFixed(1) };
            })(),
          });
        }
        if (!isSvg) walk(e, depth + 1);
      }
    };
    walk(root, 0);
    return out;
  }

  const all = Object.values(results);
  const applicable = all.filter(
    (r) => r.status !== "NOT_APPLICABLE" && r.status !== "MISSING_OURS"
  );
  const resolvedCount = all.filter((r) => r.status === "OK").length;
  return {
    landmarks: results,
    health: {
      shell,
      total: landmarks.length,
      applicable: applicable.length,
      notApplicable: all.length - applicable.length,
      missingOurs: all.filter((r) => r.status === "MISSING_OURS").length,
      resolved: resolvedCount,
      resolutionRate: applicable.length
        ? +(resolvedCount / applicable.length).toFixed(2)
        : 1,
      viewport: { w: innerWidth, h: innerHeight },
      docHeight: document.documentElement.scrollHeight,
    },
  };
};
