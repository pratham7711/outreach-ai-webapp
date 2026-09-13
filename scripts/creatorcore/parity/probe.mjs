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

  const resolvers = {
    /* The header strip is not reliably findable by position: on their campaign
       screens a white content card sits in the same band and a geometry probe
       picks it instead (measured: 29 of 45 surfaces resolved a 72-100px card
       rather than the 40px strip, which then reported a white background and a
       10px radius as "drift" against our transparent one).

       Defining it structurally instead -- the nearest ancestor of the TITLE that
       spans the content column -- cannot pick a sibling card, because the title
       is inside the strip by definition. */
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
          if (spec.siblingRun.rightOfRail && rects[0].x < railRight - 1) continue;
          runs.push({ kids, count: kids.length });
        }
        runs.sort((a, b) => b.count - a.count);
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

    const status = error ? "ERROR" : els.length === 0 ? "UNRESOLVED" : els.length > 1 && !isSeries(spec) ? "AMBIGUOUS" : "OK";
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
           the label text, and `backgroundColor` from the nearest element at or
           inside the row that paints something other than transparent. */
        const labelOf = (row) => {
          const own = (e) => [...e.childNodes].some(
            (n) => n.nodeType === 3 && n.textContent.trim());
          const kids = [...row.querySelectorAll("*")].filter((e) => visible(e) && own(e));
          return kids.length ? kids[kids.length - 1] : row;
        };
        const paintedOf = (row) => {
          const opaque = (e) => {
            const bg = getComputedStyle(e).backgroundColor;
            return bg && bg !== "transparent" && !/,\s*0\s*\)$/.test(bg);
          };
          if (opaque(row)) return row;
          return [...row.querySelectorAll("*")].find((e) => visible(e) && opaque(e)) || row;
        };
        const paintOf = (e) => {
          const lab = getComputedStyle(labelOf(e));
          const bg = getComputedStyle(paintedOf(e));
          const own = getComputedStyle(e);
          const o = {};
          for (const p of PAINT) o[p] = own[p];
          o.color = lab.color;
          o.fontWeight = lab.fontWeight;
          o.backgroundColor = bg.backgroundColor;
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
        entry.states = {
          groupCount: ordered.length,
          rest: ordered[0]?.paint ?? null,
          restCount: ordered[0]?.n ?? 0,
          /* The selected row is the SMALLEST group, not merely the second one:
             a rail can carry a third style (a disabled row, a promoted row),
             and the selected one is the group of one. When every row paints the
             same -- a rail whose selection is drawn some other way -- there is
             no active style to compare, and null says so rather than inventing
             one from the runner-up. */
          active: ordered.length > 1 ? ordered[ordered.length - 1].paint : null,
          activeText: ordered.length > 1 ? ordered[ordered.length - 1].texts[0] : null,
          activeCount: ordered.length > 1 ? ordered[ordered.length - 1].n : 0,
        };
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
    e.rel = o ? { dx: +(e.rect.x - o.x).toFixed(1), dy: +(e.rect.y - o.y).toFixed(1) } : null;
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
        const r = e.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) { walk(e, depth + 1); continue; }
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
          });
        }
        walk(e, depth + 1);
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
