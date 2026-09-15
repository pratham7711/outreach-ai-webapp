/**
 * Pairs our census against theirs and reports what is not in the same place.
 *
 *   node scripts/creatorcore/parity/censusdiff.mjs --ref <dir> --ours <dir> \
 *        [--viewport desktop-1600] [--only <substr>] [--tol 4]
 *
 * Output goes to scripts/creatorcore/out/ -- which is gitignored -- because a
 * census records visible text verbatim and the reference org's campaign names
 * are not ours to commit. Only prose findings belong in docs/parity.
 *
 * Matching: by kind + digit-collapsed text key, positionally within a key.
 * Charts, images and boxes carry ordinal keys already, so those match top-to-
 * bottom, which is what "the same chart in the same place" means.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

const REF = opt("--ref", null);
const OURS = opt("--ours", null);
const VP = opt("--viewport", "desktop-1600");
const ONLY = opt("--only", null);
const TOL = Number(opt("--tol", 4));
if (!REF || !OURS) {
  console.error("need --ref <dir> and --ours <dir>");
  process.exit(2);
}

/**
 * Our surface ids and theirs are not the same string. Theirs come from
 * surfaces.mjs (`campaign-busy-posts`); ours from capture-ours.mjs. The map is
 * explicit rather than fuzzy, because a wrong pairing produces a confident diff
 * of two unrelated screens -- the failure mode that is worst to debug.
 */
const ALIASES = {
  "nav-campaigns": ["campaigns"],
  "nav-activations": ["activations"],
  "nav-calendar": ["calendar"],
  "nav-clients": ["clients"],
  "nav-creators": ["creators"],
  "nav-lists": ["lists"],
  "nav-payouts": ["payouts"],
  "nav-requests": ["requests"],
  "nav-recipients": ["recipients"],
  "nav-connections": ["connections"],
  "nav-discovery": ["discovery"],
  "nav-fan-pages": ["fan-pages"],
  "settings-general": ["settings-general"],
  "settings-team": ["settings-team"],
  "settings-notifications": ["settings-notifications"],
  "settings-integrations": ["settings-integrations"],
  "settings-profile": ["settings-account"],
};
/* Their campaign fixtures are three different campaigns; the "busy" one is the
   closest match to ours by volume, so it leads and the others are fallbacks for
   a section that only one fixture happened to capture. */
for (const sub of ["overview", "creators", "drafts", "posts", "analytics", "financials", "documents"]) {
  ALIASES[`campaign-${sub}`] = [`campaign-busy-${sub}`, `campaign-reference-${sub}`, `campaign-quiet-${sub}`];
}
ALIASES["campaign-edit"] = ["campaign-busy-settings", "campaign-reference-settings"];

const loadDir = (dir) => {
  const d = path.join(dir, VP);
  if (!existsSync(d)) return {};
  const out = {};
  for (const f of readdirSync(d)) {
    if (!f.endsWith(".census.json")) continue;
    out[f.replace(".census.json", "")] = JSON.parse(readFileSync(path.join(d, f), "utf8"));
  }
  return out;
};

const ref = loadDir(REF);
const ours = loadDir(OURS);

const byKey = (census) => {
  const m = new Map();
  for (const it of census.items) {
    const k = it.kind + " " + it.key;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(it);
  }
  for (const list of m.values()) list.sort((a, b) => a.y - b.y || a.x - b.x);
  return m;
};

const rows = [];
const surfaceRows = [];

for (const [ourId, refCandidates] of Object.entries(ALIASES)) {
  if (ONLY && !ourId.includes(ONLY)) continue;
  const o = ours[ourId];
  if (!o) continue;
  const refId = refCandidates.find((c) => ref[c]);
  if (!refId) continue;
  const r = ref[refId];

  const mo = byKey(o);
  const mr = byKey(r);
  let moved = 0, missing = 0, extra = 0, matched = 0;

  /* WHAT IS COMPARABLE, and why the first version of this file was not.
     Raw per-item deltas across a whole page reported 58 of 60 items moved on
     `campaigns` alone -- and that number is an artifact, not a finding. The two
     orgs hold different data, so a list with 12 rows on one side and 10 on the
     other displaces every matched string below it; the measured per-surface
     IQR of dy ran to 300-460px, which is the signature of content drift rather
     than a layout offset.

     So a row is only compared when the pairing is unambiguous:
       - text and controls, only where the key occurs EXACTLY ONCE on each side.
         A label that appears once on both screens is chrome -- a heading, a
         column name, a button, a tab. A repeated one is a data row.
       - charts, by ordinal, always. "The same chart in the same place" is the
         question, and there are never many.
       - painted boxes, the largest dozen only. Those are the shell, the rail,
         the header card and the main panel, which are structural on any data.
       - images are counted but never positioned: they are avatars and post
         thumbnails, which is data.
     Everything dropped here is reported as `skipped` rather than silently
     ignored, because an empty diff and an unmeasured one look identical. */
  const BOX_ORDINALS = 12;
  let skipped = 0;
  const comparable = (kind, key, theirs, mine) => {
    if (kind === "image") return false;
    if (kind === "chart") return true;
    if (kind === "box") return Number(key.split("#")[1]) < BOX_ORDINALS;
    return theirs.length === 1 && mine.length === 1;
  };

  for (const [k, theirs] of mr) {
    const mine = mo.get(k) || [];
    const sp = k.indexOf(" ");
    const kind = k.slice(0, sp);
    const key = k.slice(sp + 1);
    if (mine.length && !comparable(kind, key, theirs, mine)) { skipped += theirs.length; continue; }
    const pairs = Math.min(theirs.length, mine.length);
    for (let i = 0; i < pairs; i++) {
      const t = theirs[i], u = mine[i];
      matched++;
      const dx = +(u.x - t.x).toFixed(1), dy = +(u.y - t.y).toFixed(1);
      const dw = +(u.w - t.w).toFixed(1), dh = +(u.h - t.h).toFixed(1);
      const worst = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dw), Math.abs(dh));
      if (worst > TOL) {
        moved++;
        rows.push({ surface: ourId, kind, key, i, worst, dx, dy, dw, dh,
          theirs: { x: t.x, y: t.y, w: t.w, h: t.h }, oursRect: { x: u.x, y: u.y, w: u.w, h: u.h },
          text: (t.text || "").slice(0, 44), fsT: t.fs, fsO: u.fs, fwT: t.fw, fwO: u.fw });
      }
    }
    if (theirs.length > pairs && (kind === "chart" || kind === "control" || (kind === "text" && theirs.length === 1))) {
      missing += theirs.length - pairs;
      for (const t of theirs.slice(pairs))
        rows.push({ surface: ourId, kind, key, verdict: "MISSING", worst: 999,
          theirs: { x: t.x, y: t.y, w: t.w, h: t.h }, text: (t.text || "").slice(0, 44) });
    }
  }
  for (const [k, mine] of mo) {
    const theirs = mr.get(k) || [];
    const sp2 = k.indexOf(" ");
    const kind2 = k.slice(0, sp2);
    if (mine.length > theirs.length && (kind2 === "chart" || kind2 === "control" || (kind2 === "text" && mine.length === 1))) {
      const kind = kind2;
      const key = k.slice(sp2 + 1);
      extra += mine.length - theirs.length;
      for (const u of mine.slice(theirs.length))
        rows.push({ surface: ourId, kind, key, verdict: "EXTRA", worst: 998,
          oursRect: { x: u.x, y: u.y, w: u.w, h: u.h }, text: (u.text || "").slice(0, 44) });
    }
  }
  surfaceRows.push({ surface: ourId, refId, matched, moved, missing, extra, skipped,
    theirCounts: r.counts, ourCounts: o.counts, theirZoom: r.zoom, ourZoom: o.zoom });
}

rows.sort((a, b) => b.worst - a.worst || a.surface.localeCompare(b.surface));

const OUT = path.join(HERE, "..", "out", "census");
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, `diff-${VP}.json`), JSON.stringify({ viewport: VP, tol: TOL, surfaceRows, rows }, null, 2));

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(`=== census diff  ${VP}  tol=${TOL}px  surfaces=${surfaceRows.length} ===`);
console.log(`${pad("surface", 24)} ${pad("matched", 8)} ${pad("moved", 6)} ${pad("missing", 8)} ${pad("extra", 6)} ${pad("skipped", 8)} zoom t/o`);
for (const s of surfaceRows)
  console.log(`${pad(s.surface, 24)} ${pad(s.matched, 8)} ${pad(s.moved, 6)} ${pad(s.missing, 8)} ${pad(s.extra, 6)} ${pad(s.skipped, 8)} ${s.theirZoom}/${s.ourZoom}`);

const moves = rows.filter((r) => !r.verdict);
const shown = moves.slice(0, Number(opt("--top", 40)));
console.log(`--- worst moves (of ${moves.length}) ---`);
for (const r of shown)
  console.log(`${pad(r.surface, 22)} ${pad(r.kind, 7)} ${pad(r.text || r.key, 30)} d=(${r.dx},${r.dy}) size=(${r.dw},${r.dh})  theirs=${r.theirs.x},${r.theirs.y} ${r.theirs.w}x${r.theirs.h}  ours=${r.oursRect.x},${r.oursRect.y} ${r.oursRect.w}x${r.oursRect.h}`);

console.log(`full: scripts/creatorcore/out/census/diff-${VP}.json`);
