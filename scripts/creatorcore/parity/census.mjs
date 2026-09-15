/**
 * A full census of everything painted on the first screen.
 *
 * `landmarks.mjs` names ten things and measures those. That is the right shape
 * for a regression gate and the wrong shape for the question "is everything
 * where theirs is", because a landmark that resolves on one side and not the
 * other reads as "not measured" rather than as a difference -- which is exactly
 * how nine surfaces stayed silent while their primary action sat in the wrong
 * place (see CampaignHeaderActions). This module asks the complementary
 * question: enumerate EVERY painted thing, then let the diff find what has no
 * counterpart.
 *
 * Scope is the FIRST SCREEN at rest -- no scrolling, viewport coordinates. That
 * is what "on our screen" means, it is what the viewport screenshots show, and
 * it keeps the two sides in one coordinate frame even though the reference
 * scrolls the window while we scroll `main`.
 *
 * getBoundingClientRect is already zoom-adjusted in Chrome, so a zoomed canvas
 * (theirs at <=1500, ours in the two creatorcore bands) reports the box the
 * user actually sees. No zoom compensation belongs here.
 */
export const CENSUS = () => {
  const vw = innerWidth;
  const vh = innerHeight;
  const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();

  /* The match key. Digits collapse to # because the two orgs hold different
     data: "88 Posts" and "12 Posts" are the same label in different campaigns,
     and treating them as different strings would report every count as a
     missing element. Currency symbols and the redactor's own fills collapse the
     same way. */
  const keyOf = (s) =>
    norm(s)
      .toLowerCase()
      .replace(/[\d]+([.,][\d]+)*/g, "#")
      .replace(/a{4,}/g, "a*")
      .slice(0, 64);

  const px = (v) => Math.round(v * 10) / 10;
  const rectOf = (r) => ({ x: px(r.left), y: px(r.top), w: px(r.width), h: px(r.height) });
  const onScreen = (r) => r.width > 0.5 && r.height > 0.5 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;

  const paints = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return null;
    if (Number(cs.opacity) < 0.05) return null;
    return cs;
  };

  const items = [];
  const push = (kind, key, rect, extra) => items.push({ kind, key, ...rect, ...extra });

  /* ── Text, measured on a Range rather than the element box ────────────────
     A heading's element box is often the full content width while the glyphs
     occupy 180px of it, and "where is this text" means the glyphs. Ranges give
     the painted run directly. */
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let n;
  while ((n = walker.nextNode())) {
    const text = norm(n.textContent);
    if (!text) continue;
    const parent = n.parentElement;
    if (!parent) continue;
    if (/^(script|style|noscript|title)$/i.test(parent.tagName)) continue;
    const cs = paints(parent);
    if (!cs) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (!onScreen(r)) continue;
    push("text", keyOf(text), rectOf(r), {
      text: text.slice(0, 80),
      fs: px(parseFloat(cs.fontSize)),
      fw: cs.fontWeight,
      color: cs.color,
      align: cs.textAlign,
      tag: parent.tagName.toLowerCase(),
    });
  }

  /* ── Controls ─────────────────────────────────────────────────────────────
     Keyed on the accessible name, not the text, so an icon-only button still
     has an identity. Buttons also appear in the text pass; that is deliberate --
     one row proves the label is in place, the other proves the hit box is. */
  const CONTROL = 'button,a[href],input,select,textarea,[role="button"],[role="tab"],[role="switch"],[role="checkbox"]';
  for (const el of document.querySelectorAll(CONTROL)) {
    const cs = paints(el);
    if (!cs) continue;
    const r = el.getBoundingClientRect();
    if (!onScreen(r)) continue;
    const name = norm(el.getAttribute("aria-label") || el.getAttribute("title") || el.value || el.placeholder || el.textContent);
    push("control", keyOf(name || el.tagName), rectOf(r), {
      text: (name || "").slice(0, 80),
      tag: el.tagName.toLowerCase(),
      bg: cs.backgroundColor,
      color: cs.color,
      radius: cs.borderTopLeftRadius,
      border: cs.borderTopWidth === "0px" ? "none" : `${cs.borderTopWidth} ${cs.borderTopColor}`,
    });
  }

  /* ── Charts and canvases ──────────────────────────────────────────────────
     Bubble draws with Chart.js into a <canvas>; Recharts draws an <svg>. Both
     are "the chart" and both must be found by the same pass, so the key is the
     kind and the ordinal, never the markup. Icons are svgs too, so area is the
     separator -- 3000px^2 is well above a 24px glyph and well below any chart
     worth comparing. */
  const drawings = [];
  for (const el of document.querySelectorAll("svg,canvas")) {
    const cs = paints(el);
    if (!cs) continue;
    const r = el.getBoundingClientRect();
    if (!onScreen(r) || r.width * r.height < 3000) continue;
    if (el.closest("svg") !== el && el.tagName.toLowerCase() === "svg") continue;
    drawings.push({ el, r, tag: el.tagName.toLowerCase() });
  }
  drawings.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
  drawings.forEach((d, i) =>
    push("chart", `chart#${i}`, rectOf(d.r), { tag: d.tag, area: Math.round(d.r.width * d.r.height) })
  );

  /* ── Images ───────────────────────────────────────────────────────────────*/
  const imgs = [];
  for (const el of document.querySelectorAll("img")) {
    const cs = paints(el);
    if (!cs) continue;
    const r = el.getBoundingClientRect();
    if (!onScreen(r)) continue;
    imgs.push({ r, radius: cs.borderTopLeftRadius });
  }
  imgs.sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);
  imgs.forEach((m, i) => push("image", `image#${i}`, rectOf(m.r), { radius: m.radius }));

  /* ── Painted boxes: cards, pills, panels, rails ───────────────────────────
     An element counts only if it paints its OWN ground or edge -- a transparent
     wrapper is layout, not something on the screen. Ordered by area and capped,
     because a deep tree has hundreds of nested divs and the large ones are the
     ones a person would point at. */
  const boxes = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = paints(el);
    if (!cs) continue;
    const bg = cs.backgroundColor;
    const opaque = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
    const bw = parseFloat(cs.borderTopWidth) || parseFloat(cs.borderBottomWidth) || 0;
    const shadow = cs.boxShadow && cs.boxShadow !== "none";
    if (!opaque && bw === 0 && !shadow) continue;
    const r = el.getBoundingClientRect();
    if (!onScreen(r) || r.width * r.height < 900) continue;
    boxes.push({ r, bg, radius: cs.borderTopLeftRadius, border: bw ? `${cs.borderTopWidth} ${cs.borderTopColor}` : "none", shadow: shadow ? "y" : "n" });
  }
  boxes.sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  boxes.slice(0, 220).forEach((b, i) =>
    push("box", `box#${i}`, rectOf(b.r), { bg: b.bg, radius: b.radius, border: b.border, shadow: b.shadow })
  );

  return {
    viewport: { w: vw, h: vh },
    zoom: getComputedStyle(document.body).zoom,
    scroll: { x: Math.round(scrollX), y: Math.round(scrollY) },
    counts: items.reduce((a, i) => ((a[i.kind] = (a[i.kind] || 0) + 1), a), {}),
    items,
  };
};
