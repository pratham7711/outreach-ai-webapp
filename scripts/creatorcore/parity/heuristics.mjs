/**
 * The design critic's rulebook.
 *
 * Everything in the parity harness so far answers "does ours measure the same
 * as theirs". That is necessary and it is not sufficient: a screen can match a
 * reference number for number and still be badly designed, and -- more to the
 * point here -- a screen of OURS that has no reference counterpart gets no
 * verdict at all from a diff. 22 of our dashboard routes are in exactly that
 * position.
 *
 * So this file encodes the other half: named, checkable design laws applied to
 * the structural tree the probe already collects. Each rule cites the law it
 * comes from, because a finding a reader cannot trace to a principle is just an
 * opinion with a line number.
 *
 * The laws, and what each one can actually be checked against:
 *
 *   Jakob's Law -- people spend most of their time on OTHER products, so they
 *     expect yours to work the way those do. This is the only law here with an
 *     empirical oracle available: the reference product IS the convention the
 *     user is being measured against, so `jakob/*` rules compare our tree to
 *     theirs rather than to an abstract ideal.
 *   Fitts's Law -- acquisition time grows as target size shrinks and distance
 *     grows. Checkable outright from the rects.
 *   Hick's Law -- decision time grows with the number of equally-weighted
 *     choices. Checkable as a sibling count inside one action cluster.
 *   Gestalt (proximity, common region, alignment) -- what the eye groups.
 *     Checkable from gaps and shared edges.
 *   Nielsen's heuristics -- #4 consistency and standards, #6 recognition rather
 *     than recall, #8 aesthetic and minimalist design.
 *   WCAG 2.2 -- 1.4.3 contrast, 2.5.8 target size. Not taste; a floor.
 *
 * A rule returns zero or more findings. Every finding carries a stable `rule`
 * id so the loop can tell "the same six problems" from "six new problems", and
 * a `fix` naming the token or class that would move it -- a critique with no
 * lever is a complaint.
 */

const num = (v) => parseFloat(v) || 0;

/* sRGB relative luminance, per WCAG 2.x. Alpha is composited onto `over`
   because a half-transparent ink over a white card is not the colour it
   declares, and reading the declared value is how contrast bugs survive an
   audit. */
function rgb(c) {
  const m = /rgba?\(([^)]+)\)/.exec(c || "");
  if (!m) return null;
  const p = m[1].split(",").map((x) => parseFloat(x));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function lum({ r, g, b }) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrast(fg, bg) {
  const F = rgb(fg), B = rgb(bg);
  if (!F || !B || B.a === 0) return null;
  const over = F.a >= 1 ? F : {
    r: F.r * F.a + B.r * (1 - F.a),
    g: F.g * F.a + B.g * (1 - F.a),
    b: F.b * F.a + B.b * (1 - F.a),
  };
  const a = lum(over), b = lum(B);
  return +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
}

const INTERACTIVE = new Set(["button", "link", "input", "toggle", "select"]);
const isHit = (n) => INTERACTIVE.has(n.role);

/* The nearest painted ancestor's background, walking back up the tree list. A
   node inheriting `rgba(0,0,0,0)` has the colour of whatever is behind it, and
   scoring contrast against transparent is how an audit passes a screen nobody
   can read.

   "Ancestor" has to mean CONTAINMENT, not "earlier and up and to the left".
   The first version tested `depth < n.depth && x <= n.x && y <= n.y`, which any
   node in a preceding branch satisfies -- and the brand chip at the top of the
   rail, being solid indigo, was picked as the ground for every indigo nav label
   below it. That reported 561 contrast failures at exactly 1:1 on text that
   measures 7.12:1 in the browser. A ratio of exactly 1 is the signature of this
   bug: it means the ink was scored against itself. */
function bgBehind(tree, i) {
  const n = tree[i];
  for (let j = i; j >= 0; j--) {
    const c = tree[j];
    if (j !== i) {
      const contains =
        c.depth < n.depth &&
        c.x <= n.x && c.y <= n.y &&
        c.x + c.w >= n.x + n.w && c.y + c.h >= n.y + n.h;
      if (!contains) continue;
    }
    const p = rgb(c.bg);
    if (p && p.a > 0.5) return c.bg;
  }
  /* The page ground. Not white unconditionally -- but the tree is landmark
     scoped and the landmark's own root is tree[0], so falling through here
     means nothing in the landmark paints, and the app ground is the answer. */
  return "rgb(255, 255, 255)";
}

/* Siblings: same depth, same landmark, consecutive in document order. The tree
   is emitted depth-first, so a run of equal-depth nodes uninterrupted by a
   shallower one is one parent's child list. */
function sibRuns(tree) {
  const runs = [];
  let cur = null;
  for (const n of tree) {
    if (cur && n.depth === cur.depth) { cur.nodes.push(n); continue; }
    if (n.depth > (cur?.depth ?? -1)) { cur = { depth: n.depth, nodes: [n] }; runs.push(cur); continue; }
    cur = { depth: n.depth, nodes: [n] };
    runs.push(cur);
  }
  return runs.filter((r) => r.nodes.length > 1);
}

const F = (rule, law, severity, where, message, fix, evidence) =>
  ({ rule, law, severity, where, message, fix, evidence });

/* ── Fitts's Law + WCAG 2.5.8 ──────────────────────────────────────────── */
export function fitts(tree, lm) {
  const out = [];
  const hits = tree.filter(isHit);
  for (const n of hits) {
    /* 24 CSS px is the WCAG 2.2 AA floor (2.5.8 Target Size Minimum); below it
       is a conformance failure, not a preference. Icon-only controls are the
       ones that fail, and they are exactly the controls with no label to aim
       at either. */
    if (n.w < 24 || n.h < 24) {
      out.push(F("fitts/target-below-wcag-minimum", "Fitts / WCAG 2.5.8", n.w < 20 || n.h < 20 ? "high" : "med",
        `${lm} › ${n.role} "${n.nm || n.raw || "(unlabelled)"}"`,
        `Hit target is ${n.w}×${n.h}px; WCAG 2.2 AA requires 24×24 and a comfortable pointer target is 40×40.`,
        "Give the control a padded box -- `.cc-icon-btn` sizes from --cc-icon-btn-size.",
        { w: n.w, h: n.h }));
    }
  }
  /* Adjacent targets with no clear space between them: the miss lands on the
     neighbour, which is worse than landing on nothing. */
  for (let i = 1; i < hits.length; i++) {
    const a = hits[i - 1], b = hits[i];
    const sameRow = Math.abs(a.y - b.y) < 4;
    const gap = b.x - (a.x + a.w);
    if (sameRow && gap >= 0 && gap < 6 && a.w < 200 && b.w < 200) {
      out.push(F("fitts/adjacent-targets-no-gap", "Fitts", "med",
        `${lm} › "${a.nm || a.raw}" ↔ "${b.nm || b.raw}"`,
        `${gap.toFixed(1)}px of clear space between two adjacent targets; a near-miss activates the wrong one.`,
        "Raise the cluster gap token (--cc-*-gap) to at least 8px.",
        { gap: +gap.toFixed(1) }));
    }
  }
  return out;
}

/* ── Hick's Law ────────────────────────────────────────────────────────── */
export function hicks(tree, lm) {
  const out = [];
  for (const run of sibRuns(tree)) {
    const acts = run.nodes.filter(isHit);
    /* Equally-weighted is the operative word: a nav list of 20 is fine because
       it is scanned, not chosen between. A row of peer BUTTONS is chosen
       between, and past about seven the choice itself becomes the work. */
    if (acts.length > 7 && acts.every((n) => n.role === "button")) {
      out.push(F("hicks/too-many-peer-actions", "Hick", "med",
        `${lm} › a row of ${acts.length} buttons`,
        `${acts.length} peer actions presented at equal weight. Decision time grows with the count; nothing here says which one is the point.`,
        "Promote one to primary (data-cc-slot=\"primary\") and collapse the tail behind an overflow.",
        { count: acts.length, labels: acts.slice(0, 10).map((n) => n.nm || n.raw) }));
    }
  }
  return out;
}

/* ── Gestalt ───────────────────────────────────────────────────────────── */
export function gestalt(tree, lm) {
  const out = [];
  for (const run of sibRuns(tree)) {
    const ns = run.nodes;
    if (ns.length < 2) continue;
    const vertical = ns.every((n, i) => i === 0 || n.y >= ns[i - 1].y + ns[i - 1].h - 2);
    if (!vertical) continue;

    /* Alignment. A vertical stack has ONE left edge; a child that sits on a
       different one reads as belonging to something else. This is the rule that
       catches a centred icon pair dropped into a left-aligned column -- the
       eye has nothing to group it to, so it floats. */
    const lefts = ns.map((n) => n.x);
    const modal = lefts.slice().sort((a, b) =>
      lefts.filter((v) => Math.abs(v - a) < 2).length - lefts.filter((v) => Math.abs(v - b) < 2).length).pop();
    const strays = ns.filter((n) => Math.abs(n.x - modal) > 2 && n.w < run.nodes[0].w * 0.98);
    if (strays.length && strays.length < ns.length) {
      for (const s of strays) {
        out.push(F("gestalt/alignment-break", "Gestalt (alignment)", "high",
          `${lm} › "${s.nm || s.raw || s.role}"`,
          `Sits at x=${s.x} while its ${ns.length - strays.length} siblings share x=${modal}. A stack has one alignment edge; a child off it reads as unrelated furniture.`,
          "Align to the stack edge, or give the odd child its own bounded region (Gestalt common region) so the break is deliberate.",
          { x: s.x, siblingsAt: modal }));
      }
    }

    /* Proximity. If the space BETWEEN groups is no larger than the space
       WITHIN one, the grouping the layout intends is not the grouping the eye
       performs. */
    const gaps = ns.slice(1).map((n, i) => +(n.y - (ns[i].y + ns[i].h)).toFixed(1)).filter((g) => g >= 0);
    if (gaps.length >= 3) {
      const max = Math.max(...gaps), min = Math.min(...gaps);
      if (max > 0 && max - min < 2 && ns.length > 4) {
        out.push(F("gestalt/uniform-gaps-no-grouping", "Gestalt (proximity)", "low",
          `${lm} › ${ns.length} siblings`,
          `Every gap is ${min}-${max}px, so the run reads as one undifferentiated list with no structure.`,
          "Separate the groups with a larger token (--cc-sp-*) between them than within.",
          { gaps }));
      }
    }
  }
  return out;
}

/* ── Nielsen ───────────────────────────────────────────────────────────── */
export function nielsen(tree, lm) {
  const out = [];

  for (const n of tree) {
    /* #6, recognition rather than recall. An icon with no accessible name is a
       control the user must click to identify -- and a screen reader user
       cannot identify at all. */
    if (isHit(n) && !n.nm && !n.raw) {
      out.push(F("nielsen/h6-unlabelled-control", "Nielsen #6 (recognition over recall)", "high",
        `${lm} › unlabelled ${n.role} at ${n.x},${n.y}`,
        "Interactive control with no text, aria-label, title or alt. Nothing identifies it before it is clicked.",
        "Add aria-label + title, or a visible label.",
        { x: n.x, y: n.y, w: n.w, h: n.h }));
    }

    /* #8, aesthetic and minimalist design -- and more bluntly, a clipped proper
       noun is the one string a reader cannot repair from context. */
    if (n.tr) {
      out.push(F("nielsen/h8-truncated-text", "Nielsen #8 (aesthetic and minimalist design)", n.role === "heading" ? "high" : "med",
        `${lm} › "${n.raw}"`,
        "Text is clipped by its container. A truncated name reads as a bug, not as brevity.",
        "Give the element the row (flex-grow) or drop the neighbour that is taking it.",
        { text: n.raw, w: n.w }));
    }

    /* WCAG 1.4.3. A floor, not taste. */
    const i = tree.indexOf(n);
    if ((n.raw || n.text) && n.fg) {
      const ground = bgBehind(tree, i);
      const c = contrast(n.fg, ground);
      const big = num(n.fs) >= 24 || (num(n.fs) >= 18.66 && num(n.fw) >= 700);
      const floor = big ? 3 : 4.5;
      /* Exactly 1:1 means the ink was scored against itself, which no real
         design does -- it means the ground resolution failed, usually because
         the painted node did not make it into the capped tree. Reported as a
         harness finding, never as a contrast one: a false contrast failure
         sends someone to change a colour that is fine. */
      if (c !== null && c >= 0.995 && c <= 1.005) {
        out.push(F("harness/ground-unresolved", "harness health", "low",
          `${lm} › "${n.raw}"`,
          `Ink and ground resolved to the same colour (${n.fg}); this node's painted ancestor is not in the tree, so its contrast was not measured.`,
          "Raise the tree cap, or treat this node as unmeasured.",
          { fg: n.fg, ground }));
      } else if (c !== null && c < floor) {
        out.push(F("wcag/contrast-below-aa", "WCAG 1.4.3", c < floor - 1 ? "high" : "med",
          `${lm} › "${n.raw}"`,
          `Contrast ${c}:1 against its ground; AA needs ${floor}:1 at ${n.fs}/${n.fw}.`,
          "Re-point the ink token, not the literal -- --cc-text-muted / --cc-text-subtle.",
          { ratio: c, need: floor, fg: n.fg, fs: n.fs }));
      }
    }
  }

  /* #4, consistency and standards: the same control drawn two ways on one
     screen. Keyed on accessible name, because two buttons that say the same
     word and look different is the version of this the user actually notices. */
  const byName = new Map();
  for (const n of tree) {
    if (!isHit(n) || !n.nm) continue;
    const k = n.nm.toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(n);
  }
  for (const [, ns] of byName) {
    if (ns.length < 2) continue;
    const paints = new Set(ns.map((n) => `${n.bg}|${n.fg}|${n.r}`));
    if (paints.size > 1) {
      out.push(F("nielsen/h4-same-control-two-paints", "Nielsen #4 (consistency and standards)", "med",
        `${lm} › "${ns[0].nm}" ×${ns.length}`,
        `The same action is painted ${paints.size} different ways on one screen.`,
        "One recipe, one class. Variants re-point --cc-btn-bg/-fg/-border rather than adding a class.",
        { variants: [...paints] }));
    }
  }
  return out;
}

/* ── Jakob's Law ───────────────────────────────────────────────────────────
   The only rules here with an oracle. Everything above asks "is this good
   design"; these ask "is this the design the user already knows", and the
   reference tree is the answer. */
export function jakob(ourTree, refTree, lm) {
  const out = [];
  if (!refTree || !refTree.length) return out;

  const acts = (t) => t.filter((n) => n.role === "button" && (n.nm || n.raw)).slice(0, 12);
  const ours = acts(ourTree), theirs = acts(refTree);
  if (!ours.length || !theirs.length) return out;

  /* Primary-first vs primary-last. Their solid brand button leads the cluster;
     a user who has learned "the blue one is first here" scans left and finds
     ours is a neutral outline. */
  const solid = (n) => {
    const p = rgb(n.bg);
    return p && p.a > 0.5 && lum(p) < 0.6;
  };
  const ourIdx = ours.findIndex(solid), theirIdx = theirs.findIndex(solid);
  if (ourIdx >= 0 && theirIdx >= 0 && ourIdx !== theirIdx) {
    out.push(F("jakob/primary-action-position", "Jakob", "high",
      `${lm} › action cluster`,
      `Their primary sits at position ${theirIdx + 1} of ${theirs.length}; ours at ${ourIdx + 1} of ${ours.length}. The learned scan order does not find it.`,
      "Re-point --cc-order-primary on the [data-cc-slot=\"primary\"] child; CSS order needs no JSX edit.",
      { ourIndex: ourIdx, theirIndex: theirIdx,
        ourLabels: ours.map((n) => n.nm || n.raw), theirLabels: theirs.map((n) => n.nm || n.raw) }));
  }

  /* A control we render that they do not. Not automatically wrong -- we have
     features they lack -- but in a theme whose whole promise is "this is the
     product you already use", every extra control is a cost that has to be
     worth paying, and naming them is how that decision gets made. */
  const theirNames = new Set(theirs.map((n) => (n.nm || n.raw).toLowerCase().replace(/\d[\d,.$%kmb+]*/g, "#")));
  const extra = ours.filter((n) => !theirNames.has((n.nm || n.raw).toLowerCase().replace(/\d[\d,.$%kmb+]*/g, "#")));
  if (extra.length) {
    out.push(F("jakob/controls-absent-from-reference", "Jakob", "low",
      `${lm} › ${extra.length} extra control${extra.length > 1 ? "s" : ""}`,
      `We render ${extra.map((n) => `"${n.nm || n.raw}"`).join(", ")}; the reference cluster has no counterpart.`,
      "Either hide it in this theme ([data-action] + display token) or accept it and record why.",
      { labels: extra.map((n) => n.nm || n.raw) }));
  }

  /* Region placement on the cross axis. "Filters are on the right" is a mental
     model, and flipping it costs more than it looks. */
  const side = (t) => {
    if (!t.length) return null;
    const cx = t.reduce((a, n) => a + n.x + n.w / 2, 0) / t.length;
    const w = Math.max(...t.map((n) => n.x + n.w));
    return cx < w * 0.4 ? "start" : cx > w * 0.6 ? "end" : "centre";
  };
  const a = side(ours), b = side(theirs);
  if (a && b && a !== b) {
    out.push(F("jakob/cluster-on-opposite-side", "Jakob", "med",
      `${lm} › action cluster`,
      `Their cluster sits at the ${b} of the row; ours at the ${a}.`,
      "Re-point the row's --cc-*-justify token.",
      { ours: a, theirs: b }));
  }
  return out;
}

export const RULES = { fitts, hicks, gestalt, nielsen, jakob };
