import { JUNK, text, type CellRules, type ImportCell } from "@/lib/creators/importParse";

/**
 * The cell readers the first creator import shipped with (2ee6781), kept
 * byte for byte and never to be edited.
 *
 * LKAY Media's roster was imported with them, and they misread part of the
 * sheet: "17.3" followers became 17, "31,2 mil" 31 million, "Indonésia"
 * "IndonÉSia". Parsing the same sheet with both these and CELL_RULES shows
 * which stored values are still exactly what this version wrote; only those
 * are corrected, so nothing an agency edited by hand or a live refresh
 * fetched since is touched.
 */

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, mil: 1e6, million: 1e6, thousand: 1e3, lakh: 1e5, lac: 1e5, cr: 1e7 };

function parseOne(raw: string): number | null {
  let s = raw.trim().toLowerCase().replace(/[+~≈$€£₹]|usd|approx\.?|about|around|followers?|subs(cribers)?|views?/g, "").trim();
  if (!s) return null;
  const m = /^([\d.,\s]*\d)\s*([a-z]*)$/.exec(s);
  if (!m) return null;
  let digits = m[1];
  const suffix = m[2];
  const mult = suffix ? SUFFIX[suffix] : 1;
  if (mult === undefined) return null;
  digits = digits.replace(/(\d)\s+(?=\d)/g, "$1"); // "477 000"
  if (/,/.test(digits) && /\./.test(digits)) {
    // Whichever comes last is the decimal mark: "1,234.5" or "1.234,5".
    digits = digits.lastIndexOf(",") > digits.lastIndexOf(".")
      ? digits.replace(/\./g, "").replace(",", ".")
      : digits.replace(/,/g, "");
  } else if (/,/.test(digits)) {
    // "391,9k" is a decimal comma; "1,234" and "12,345,678" are grouping.
    digits = /,\d{3}(,|$)/.test(digits) && !suffix ? digits.replace(/,/g, "") : digits.replace(",", ".");
  } else if ((digits.match(/\./g) ?? []).length > 1) {
    digits = digits.replace(/\./g, ""); // "1.234.567"
  } else if (/^\d{1,3}\.\d{3}$/.test(digits) && !suffix) {
    digits = digits.replace(".", ""); // "477.000"
  }
  const n = Number(digits);
  if (!Number.isFinite(n) || n < 0) return null;
  return n * mult;
}

/**
 * A follower or view count typed by a person. Unknown is null, never 0: a
 * creator who left the box empty is not a creator with no audience. A range
 * ("500-10k") reads as its midpoint.
 */
function parseCount(raw: ImportCell): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 ? Math.round(raw) : null;
  const text = String(raw).trim();
  if (!text || JUNK.test(text)) return null;
  const range = text.split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean);
  if (range.length === 2) {
    const a = parseOne(range[0]);
    const b = parseOne(range[1]);
    if (a !== null && b !== null) return Math.round((a + b) / 2);
  }
  const n = parseOne(text);
  return n === null ? null : Math.round(n);
}

/** A price per video, in whole or fractional dollars. */
function parsePrice(raw: ImportCell): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : null;
  const text = String(raw).trim();
  if (!text || JUNK.test(text) || /free|negotia|depends|dm/i.test(text)) return null;
  const range = text.split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean);
  const read = (s: string) => {
    const n = parseOne(s);
    return n !== null && n > 0 ? n : null;
  };
  if (range.length === 2) {
    const a = read(range[0]);
    const b = read(range[1]);
    if (a !== null && b !== null) return Math.round(((a + b) / 2) * 100) / 100;
  }
  const n = read(text);
  return n === null ? null : Math.round(n * 100) / 100;
}

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "United States", us: "United States", "u.s.": "United States", "u.s.a.": "United States",
  "united states": "United States", "united states of america": "United States", america: "United States", eua: "United States", "estados unidos": "United States",
  uk: "United Kingdom", "u.k.": "United Kingdom", england: "United Kingdom", "great britain": "United Kingdom", britain: "United Kingdom",
  brasil: "Brazil", brazil: "Brazil", "méxico": "Mexico", mexico: "Mexico", ph: "Philippines", philippines: "Philippines", pilipinas: "Philippines",
  india: "India", indonesia: "Indonesia", uae: "United Arab Emirates", "south korea": "South Korea", korea: "South Korea",
  "españa": "Spain", espana: "Spain", deutschland: "Germany", "türkiye": "Turkey", turkiye: "Turkey", "perú": "Peru", "colômbia": "Colombia",
};

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * One or more countries, spelled one way. "USA, Brazil" stays a list (joined
 * with ", "), because an audience split across two countries is an answer;
 * "Other" and "worldwide" are not a country and read as unknown.
 */
function normalizeCountries(raw: ImportCell): string | null {
  const text = raw == null ? "" : String(raw).trim();
  if (!text || JUNK.test(text) || /^(other|others|worldwide|global|world|all|everywhere|mixed|various)$/i.test(text)) return null;
  const parts = text
    .split(/\s*(?:,|\/|;|&|\+|\band\b|\be\b|\by\b)\s*/i)
    .map((p) => p.replace(/[()%\d.]/g, "").trim())
    .filter((p) => p && !/^(other|others|worldwide|global)$/i.test(p));
  const names = [...new Set(parts.map((p) => COUNTRY_ALIASES[p.toLowerCase()] ?? (p.length <= 3 ? p.toUpperCase() : titleCase(p))))];
  return names.length ? names.slice(0, 4).join(", ") : null;
}

function name(raw: ImportCell): string | null {
  const rawName = text(raw);
  return rawName && rawName.toLowerCase() !== "name" ? rawName : null;
}

export const LEGACY_CELL_RULES: CellRules = { count: parseCount, price: parsePrice, countries: normalizeCountries, name };
