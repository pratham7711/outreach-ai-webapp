/**
 * Measures CreatorCore's left nav so ours can be built from numbers, not eyeballs.
 *
 * Credentials come from webapp/.env (gitignored) so they never pass through a
 * chat transcript or a tool call:
 *
 *   node --env-file=.env scripts/creatorcore/cc-sidebar-spec.mjs
 *
 * VIEW ONLY. It loads two screens and reads the DOM. Nothing is clicked beyond
 * the login button, so nothing in the reference org can change.
 *
 * Bubble gives the nav no semantic structure -- no <nav>, no <ul>, no roles, no
 * stable class names -- so the rail is found by anchoring on the one string it
 * must contain, the "Campaigns & Reporting" group label, and walking outward to
 * the enclosing white card. Position is no help: the rail is a floating card
 * inset from the viewport edges, not a panel flush to x=0.
 *
 * Rows are then read by collecting descendants that own a text node, which is
 * what a nav entry looks like once Bubble is done with it, plus every painted
 * descendant -- that is how the active pill is located without a class name.
 *
 * Output: scripts/creatorcore/out/sidebar/{spec.json,sidebar.png,sidebar-*.png}
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const EMAIL = process.env.CC_EMAIL;
const PASSWORD = process.env.CC_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("CC_EMAIL and CC_PASSWORD must be set in webapp/.env (gitignored).");
  process.exit(1);
}

const OUT = path.join(import.meta.dirname, "out", "sidebar");
mkdirSync(OUT, { recursive: true });
const BASE = "https://app.creatorcore.co";

/** Everything the nav could plausibly be styled with, and nothing else. */
const PROPS = [
  "display", "flexDirection", "alignItems", "justifyContent", "gap",
  "width", "height", "minHeight", "padding", "margin", "boxSizing",
  "background", "backgroundColor", "backgroundImage",
  "border", "borderRadius", "borderRight", "borderBottom", "borderTop",
  "boxShadow", "opacity", "overflow", "position",
  "color", "fontFamily", "fontSize", "fontWeight", "lineHeight",
  "letterSpacing", "textTransform", "textAlign", "whiteSpace",
];

const probe = async (page) =>
  page.evaluate(() => {
    const PROPS = window.__PROPS;
    const read = (el) => {
      const cs = getComputedStyle(el);
      const o = {};
      for (const p of PROPS) o[p] = cs[p];
      return o;
    };
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const ownText = (el) =>
      [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .filter(Boolean)
        .join(" ");

    // The rail is a floating card inset from the viewport edges, not a panel
    // flush to x=0, so it cannot be found by position. Anchor on the first
    // group label -- text the nav is guaranteed to contain -- and walk out to
    // the enclosing white card.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node, anchor = null;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim() === "Campaigns & Reporting") { anchor = node.parentElement; break; }
    }
    if (!anchor) return { error: "group label not found" };

    let rail = null;
    for (let el = anchor; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (cs.backgroundColor === "rgb(255, 255, 255)" && r.width >= 180 && r.width <= 320) {
        rail = el;
        break;
      }
    }
    if (!rail) return { error: "no white card ancestor" };

    const inRail = [...rail.querySelectorAll("*")];

    const textNodes = inRail
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && ownText(el);
      })
      .map((el) => ({
        text: ownText(el),
        tag: el.tagName.toLowerCase(),
        rect: rect(el),
        style: read(el),
      }))
      .sort((a, b) => a.rect.y - b.rect.y);

    const icons = inRail
      .filter((el) => /^(svg|img)$/i.test(el.tagName))
      .map((el) => ({ tag: el.tagName.toLowerCase(), rect: rect(el), src: el.getAttribute?.("src") || null }))
      .filter((i) => i.rect.w > 0)
      .sort((a, b) => a.rect.y - b.rect.y);

    // Any painted element inside the rail: this is how the active pill and any
    // hover/group banding are found without knowing Bubble's class names.
    const painted = inRail
      .filter((el) => {
        const cs = getComputedStyle(el);
        const bg = cs.backgroundColor;
        if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") return false;
        const r = el.getBoundingClientRect();
        return r.width > 20 && r.height > 8;
      })
      .map((el) => ({
        text: (el.textContent || "").trim().slice(0, 40),
        tag: el.tagName.toLowerCase(),
        rect: rect(el),
        style: read(el),
      }))
      .sort((a, b) => a.rect.y - b.rect.y);

    // The fixed wrapper carries the inset, so record it too.
    let fixedWrap = null;
    for (let el = rail; el && el !== document.body; el = el.parentElement) {
      if (getComputedStyle(el).position === "fixed") { fixedWrap = { rect: rect(el), style: read(el) }; break; }
    }

    return {
      url: location.href,
      viewport: { w: innerWidth, h: innerHeight },
      rail: { tag: rail.tagName.toLowerCase(), rect: rect(rail), style: read(rail) },
      fixedWrap,
      textNodes,
      icons,
      painted,
    };
  });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
await context.addInitScript((props) => { window.__PROPS = props; }, PROPS);

const spec = {};
try {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  // Not waitForURL: it waits for a load state on top of the predicate, and this
  // Bubble app keeps enough in flight that "load" never settles. The nav's own
  // first group label is the real signal that we are in.
  await page.getByText("Campaigns & Reporting").first().waitFor({ timeout: 60_000 });
  await page.waitForTimeout(5000);
  console.log("logged in");

  // Two screens: one to see the rail with Campaigns active, one with a
  // different item active so the pill can be told apart from the row.
  for (const [name, query] of [["campaigns", "tab=Campaigns"], ["creators", "tab=Creators"]]) {
    await page.goto(`${BASE}/dashboard?${query}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    spec[name] = await probe(page);
    const r = spec[name].rail?.rect;
    if (r) {
      await page.screenshot({
        path: path.join(OUT, `sidebar-${name}.png`),
        clip: {
          x: 0,
          y: 0,
          width: Math.ceil(r.x + r.w + r.x),
          height: Math.min(1000, Math.ceil(r.y + r.h + r.y)),
        },
      });
    }
    console.log(
      `${name.padEnd(10)} rail ${r ? `${r.w}x${r.h} @${r.x}` : "NOT FOUND"} · ` +
        `${spec[name].textNodes?.length ?? 0} text · ${spec[name].painted?.length ?? 0} painted`
    );
  }

  // The campaign detail screen replaces the rail with a campaign-scoped nav.
  await page.goto(`${BASE}/dashboard?tab=Campaigns`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  writeFileSync(path.join(OUT, "spec.json"), JSON.stringify(spec, null, 2));
  console.log(`\nwrote ${path.join(OUT, "spec.json")}`);
} finally {
  await browser.close();
}
