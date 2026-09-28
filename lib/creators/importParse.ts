/**
 * Turning a spreadsheet of creators into roster people.
 *
 * Pure and shared: the import modal runs it to show what it recognised, and
 * /api/creators/import runs the same code again on the same rows, so the
 * preview and what gets saved can never disagree.
 *
 * Shaped by the first real input, LKAY Media's creator sign-up form: free-text
 * counts ("391,9k", "477 000", "500-10k"), links typed by hand ("N/A",
 * "tiktok.com/flurry.x"), one person submitting several times, and one person
 * owning a TikTok, an Instagram and a YouTube.
 */

export type ImportPlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "TWITTER";

/** TikTok first: it is the picture and name the roster shows. */
export const PRIMARY_ORDER: ImportPlatform[] = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"];

export type ParsedLink = { platform: ImportPlatform; handle: string; url: string };

export type ImportCell = string | number | boolean | Date | null | undefined;

// ─── Profile links ──────────────────────────────────────────────────────────

const JUNK = /^(n\/?a|na|none|null|nil|no|nope|-+|\.+|0+(\.0+)?|x|\?|not yet|don'?t have|dont have|no account)$/i;

const HANDLE = /^[A-Za-z0-9._-]{1,64}$/;

/** Path segments that are pages, not people. */
const RESERVED: Record<ImportPlatform, Set<string>> = {
  TIKTOK: new Set(["video", "tag", "discover", "music", "explore", "live", "search", "foryou", "t", "embed", "share"]),
  INSTAGRAM: new Set(["p", "reel", "reels", "stories", "explore", "tv", "accounts", "direct", "about", "share"]),
  YOUTUBE: new Set(["watch", "shorts", "results", "playlist", "feed", "embed", "live", "hashtag"]),
  TWITTER: new Set(["home", "i", "search", "explore", "hashtag", "intent", "share", "status"]),
};

function hostPlatform(host: string): ImportPlatform | null {
  const h = host.toLowerCase().replace(/^(www|m|mobile|vm|vt)\./, "");
  if (h === "tiktok.com" || h.endsWith(".tiktok.com")) return "TIKTOK";
  if (h === "instagram.com" || h === "instagr.am") return "INSTAGRAM";
  if (h === "youtube.com" || h === "youtu.be" || h.endsWith(".youtube.com")) return "YOUTUBE";
  if (h === "x.com" || h === "twitter.com") return "TWITTER";
  return null;
}

/**
 * Case-insensitive platforms are stored lowercased, so the unique index on
 * (orgId, platform, handle) really is one account = one row. A YouTube channel
 * id (UC + 22) is case-sensitive and kept as typed.
 */
export function normalizeHandle(platform: ImportPlatform, raw: string): string {
  const bare = raw.trim().replace(/^@+/, "");
  if (platform === "YOUTUBE" && /^UC[A-Za-z0-9_-]{22}$/.test(bare)) return bare;
  return bare.toLowerCase();
}

export function profileUrl(platform: ImportPlatform, handle: string): string {
  switch (platform) {
    case "TIKTOK":
      return `https://www.tiktok.com/@${handle}`;
    case "INSTAGRAM":
      return `https://www.instagram.com/${handle}/`;
    case "YOUTUBE":
      return /^UC[A-Za-z0-9_-]{22}$/.test(handle)
        ? `https://www.youtube.com/channel/${handle}`
        : `https://www.youtube.com/@${handle}`;
    case "TWITTER":
      return `https://x.com/${handle}`;
  }
}

export type LinkResult = { ok: true; link: ParsedLink } | { ok: false; reason: string } | { ok: false; empty: true };

/**
 * A profile link, or a bare handle when the column already says which
 * platform it belongs to. Refuses post links, short links it cannot resolve,
 * and the "N/A" people type into a required field.
 */
export function parseProfileLink(raw: ImportCell, columnPlatform?: ImportPlatform): LinkResult {
  let text = raw == null ? "" : String(raw).trim();
  if (!text || JUNK.test(text) || /^[\s/\\.,-]+$/.test(text)) return { ok: false, empty: true };

  // A link inside a sentence ("I'm on Instagram as @x ... https://..."), or two
  // pasted back to back: the first URL is the answer.
  const embedded = /https?:\/\/\S+?(?=https?:\/\/|\s|$)/i.exec(text);
  if (embedded) text = embedded[0];
  // Otherwise a sentence with no link in it is someone saying they have no
  // account there ("I don't have", "No channel"), which is an empty answer.
  else if (/\s/.test(text) && !/\.(com|am|be)\//i.test(text)) return { ok: false, empty: true };
  // One word that is neither a link nor a possible handle ("нет") is a no too.
  else if (!/[./]/.test(text) && !HANDLE.test(text.replace(/^@+/, ""))) return { ok: false, empty: true };

  const bareHandle = text.replace(/^@+/, "");
  if (columnPlatform && !text.includes("/") && !/\.(com|am|be)\b/i.test(text) && HANDLE.test(bareHandle)) {
    const handle = normalizeHandle(columnPlatform, bareHandle);
    return { ok: true, link: { platform: columnPlatform, handle, url: profileUrl(columnPlatform, handle) } };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text.replace(/^\/+/, "")}`);
  } catch {
    return { ok: false, reason: `Not a link (${text.slice(0, 40)})` };
  }
  const platform = hostPlatform(url.hostname);
  if (!platform) return { ok: false, reason: `Not a profile link (${text.slice(0, 40)})` };
  if (/^(vm|vt)\./i.test(url.hostname) || url.hostname.toLowerCase() === "youtu.be") {
    return { ok: false, reason: `Short link, open it and paste the profile link (${text.slice(0, 40)})` };
  }

  const parts = url.pathname.split("/").filter(Boolean);
  let handle: string | undefined;
  if (platform === "YOUTUBE") {
    if (parts[0]?.startsWith("@")) handle = parts[0];
    else if (["channel", "c", "user"].includes(parts[0] ?? "")) handle = parts[1];
    else if (parts[0] && !RESERVED.YOUTUBE.has(parts[0])) handle = parts[0];
  } else {
    const first = parts[0];
    // TikTok profiles are /@name, but people type tiktok.com/name as often.
    if (first && !RESERVED[platform].has(first.replace(/^@/, "").toLowerCase())) handle = first;
  }
  handle = handle ? decodeURIComponent(handle).replace(/^@+/, "") : undefined;
  if (!handle || !HANDLE.test(handle)) return { ok: false, reason: `Link isn't a profile (${text.slice(0, 40)})` };

  const normalized = normalizeHandle(platform, handle);
  return { ok: true, link: { platform, handle: normalized, url: profileUrl(platform, normalized) } };
}

// ─── Counts and money ───────────────────────────────────────────────────────

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
export function parseCount(raw: ImportCell): number | null {
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
export function parsePrice(raw: ImportCell): number | null {
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

/** A form timestamp: an Excel serial day, a Date, or text. */
export function parseTimestamp(raw: ImportCell): Date | null {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === "number" || /^\d{5}(\.\d+)?$/.test(String(raw).trim())) {
    const serial = Number(raw);
    if (serial < 20000 || serial > 80000) return null;
    return new Date(Math.round((serial - 25569) * 86400000));
  }
  const t = Date.parse(String(raw));
  return Number.isNaN(t) ? null : new Date(t);
}

// ─── Niches and countries ───────────────────────────────────────────────────

/**
 * A short, canonical tag set. The sign-up form's "Niche" box held 429 distinct
 * answers across 1,239 rows (anime 309, football 157, lyrics 156, then a long
 * tail of show titles), and a tag per answer would bury the filter. What does
 * not map here stays searchable in the creator's niche text.
 */
const NICHE_TAGS: [RegExp, string][] = [
  [/\b(anime|manga|naruto|one piece|demon slayer|jujutsu|jjk|attack on titan|aot|dragon ?ball|dbz|bleach|hunter ?x ?hunter|hxh|boruto|haikyuu|chainsaw|solo leveling|otaku|waifu)\b/, "Anime"],
  [/\b(football|soccer|futebol|futbol|fútbol|premier league|messi|ronaldo|cr7|neymar)\b/, "Football"],
  [/\b(lyrics?|lyric edits?)\b/, "Lyrics"],
  [/\b(music|songs?|rap|hip ?hop|phonk|singer|artist|dj|beats?)\b/, "Music"],
  [/\b(movies?|films?|cinema|series|tv|shows?|netflix|marvel|dc|sitcom)\b/, "Movies & TV"],
  [/\bk-?pop\b/, "K-pop"],
  [/\bk-?dramas?\b/, "K-drama"],
  [/\b(gym|fitness|workout|bodybuilding|calisthenics)\b/, "Fitness"],
  [/\b(mma|ufc|boxing|wrestling|wwe|martial arts?)\b/, "Combat sports"],
  [/\b(sports?|basketball|nba|nfl|cricket|f1|formula ?1|tennis)\b/, "Sports"],
  [/\b(cars?|car edits?|automotive|jdm|supercars?)\b/, "Cars"],
  [/\b(cartoons?|animation|disney|pixar)\b/, "Cartoons"],
  [/\b(gaming|games?|gamer|minecraft|fortnite|gta|valorant)\b/, "Gaming"],
  [/\b(motivation(al)?|quotes?|mindset|self[- ]improvement)\b/, "Motivation"],
  [/\b(memes?|funny|comedy|humou?r)\b/, "Comedy"],
];

export function nicheTags(raw: ImportCell): string[] {
  const text = raw == null ? "" : String(raw).toLowerCase();
  if (!text.trim()) return [];
  const tags = new Set<string>();
  for (const [pattern, tag] of NICHE_TAGS) if (pattern.test(text)) tags.add(tag);
  return [...tags];
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
export function normalizeCountries(raw: ImportCell): string | null {
  const text = raw == null ? "" : String(raw).trim();
  if (!text || JUNK.test(text) || /^(other|others|worldwide|global|world|all|everywhere|mixed|various)$/i.test(text)) return null;
  const parts = text
    .split(/\s*(?:,|\/|;|&|\+|\band\b|\be\b|\by\b)\s*/i)
    .map((p) => p.replace(/[()%\d.]/g, "").trim())
    .filter((p) => p && !/^(other|others|worldwide|global)$/i.test(p));
  const names = [...new Set(parts.map((p) => COUNTRY_ALIASES[p.toLowerCase()] ?? (p.length <= 3 ? p.toUpperCase() : titleCase(p))))];
  return names.length ? names.slice(0, 4).join(", ") : null;
}

// ─── Column mapping ─────────────────────────────────────────────────────────

/** One sheet per request; a Google Form export of a few thousand answers fits. */
export const MAX_IMPORT_ROWS = 3000;
export const MAX_IMPORT_PEOPLE = 2000;
/** People written per commit request, so each one finishes well inside the function limit. */
export const MAX_COMMIT_CHUNK = 250;

export const IMPORT_FIELDS = [
  "name",
  "email",
  "country",
  "audienceCountry",
  "niche",
  "price",
  "signedUpAt",
  "tiktokLink", "tiktokFollowers", "tiktokAvgViews",
  "instagramLink", "instagramFollowers", "instagramAvgViews",
  "youtubeLink", "youtubeFollowers", "youtubeAvgViews",
  "twitterLink", "twitterFollowers",
  "followers",
  "avgViews",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_LABELS: Record<ImportField, string> = {
  name: "Name",
  email: "Email",
  country: "Country",
  audienceCountry: "Audience country",
  niche: "Niche",
  price: "Price per video",
  signedUpAt: "Signed up",
  tiktokLink: "TikTok link",
  tiktokFollowers: "TikTok followers",
  tiktokAvgViews: "TikTok avg views",
  instagramLink: "Instagram link",
  instagramFollowers: "Instagram followers",
  instagramAvgViews: "Instagram avg views",
  youtubeLink: "YouTube link",
  youtubeFollowers: "YouTube subscribers",
  youtubeAvgViews: "YouTube avg views",
  twitterLink: "X / Twitter link",
  twitterFollowers: "X / Twitter followers",
  followers: "Followers (primary account)",
  avgViews: "Avg views (primary account)",
};

/** Column index → field; a column mapped to nothing is ignored. */
export type ColumnMapping = (ImportField | null)[];

function headerKey(h: ImportCell): string {
  return String(h ?? "").toLowerCase().replace(/titkok/g, "tiktok").replace(/tik tok/g, "tiktok");
}

function headerPlatform(h: string): "tiktok" | "instagram" | "youtube" | "twitter" | null {
  if (/tiktok|\btt\b/.test(h)) return "tiktok";
  if (/instagram|\big\b|\(ig\)|insta/.test(h)) return "instagram";
  if (/youtube|\byt\b/.test(h)) return "youtube";
  if (/twitter|\bx\b link/.test(h)) return "twitter";
  return null;
}

/**
 * Best guess from the header row. Each field is claimed once, first column
 * wins, except that a typed "Email" beats the form's own "Email Address" (the
 * login it was submitted from) and "Artist Name" beats "Legal Name".
 */
export function detectMapping(headers: ImportCell[]): ColumnMapping {
  const keys = headers.map(headerKey);
  const mapping: ColumnMapping = keys.map(() => null);
  const claim = (field: ImportField, test: (h: string) => boolean) => {
    if (mapping.includes(field)) return;
    const i = keys.findIndex((h, idx) => mapping[idx] === null && test(h));
    if (i >= 0) mapping[i] = field;
  };

  for (let i = 0; i < keys.length; i++) {
    const h = keys[i];
    const p = headerPlatform(h);
    if (!p) continue;
    const isLink = /link|url|profile|handle|username|account/.test(h);
    const isFollowers = /follower|subscriber|\bsubs\b/.test(h);
    const isViews = /view/.test(h);
    const field = (isLink ? `${p}Link` : isFollowers ? `${p}Followers` : isViews ? `${p}AvgViews` : null) as ImportField | null;
    if (field && (IMPORT_FIELDS as readonly string[]).includes(field) && !mapping.includes(field)) mapping[i] = field;
  }

  claim("name", (h) => /artist name|stage name|page name/.test(h));
  claim("name", (h) => /^(full )?name$|creator name|^your name/.test(h.trim()));
  claim("name", (h) => /legal name/.test(h));
  claim("email", (h) => h.trim() === "email" || /contact email|your email|e-mail/.test(h));
  claim("email", (h) => /email/.test(h) && !/guardian/.test(h));
  claim("audienceCountry", (h) => /audience/.test(h) && /country|location|region/.test(h));
  claim("country", (h) => /^country$|your country|country of residence|location/.test(h.trim()));
  claim("niche", (h) => /niche|category|genre|content type|^anime$/.test(h.trim()));
  claim("price", (h) => /price|rate|fee|cost/.test(h));
  claim("signedUpAt", (h) => /^time(stamp)?$|submitted|date/.test(h.trim()));
  claim("followers", (h) => /^followers$/.test(h.trim()));
  claim("avgViews", (h) => /^average views$|^avg views$/.test(h.trim()));
  return mapping;
}

/** The sign-up form's shape, so the modal can say it recognised it. */
export function isSignupFormMapping(mapping: ColumnMapping): boolean {
  const has = (f: ImportField) => mapping.includes(f);
  return has("name") && has("niche") && (has("tiktokLink") || has("instagramLink")) && has("price");
}

// ─── Rows → people ──────────────────────────────────────────────────────────

export type ImportLink = ParsedLink & { followersCount: number | null; averageViews: number | null };

export type ImportPerson = {
  /** 1-based sheet rows this person came from, header included. */
  rows: number[];
  name: string;
  email: string | null;
  country: string | null;
  audienceCountry: string | null;
  niche: string | null;
  tags: string[];
  rate: number | null;
  signedUpAt: Date | null;
  links: ImportLink[];
};

export type RejectedRow = { row: number; name: string; reason: string };

const LINK_FIELDS: Record<ImportPlatform, { link: ImportField; followers: ImportField; views?: ImportField }> = {
  TIKTOK: { link: "tiktokLink", followers: "tiktokFollowers", views: "tiktokAvgViews" },
  INSTAGRAM: { link: "instagramLink", followers: "instagramFollowers", views: "instagramAvgViews" },
  YOUTUBE: { link: "youtubeLink", followers: "youtubeFollowers", views: "youtubeAvgViews" },
  TWITTER: { link: "twitterLink", followers: "twitterFollowers" },
};

function text(v: ImportCell): string | null {
  if (v == null) return null;
  const s = (v instanceof Date ? v.toISOString() : String(v)).trim();
  return s && !JUNK.test(s) ? s : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function primaryLink<T extends { platform: ImportPlatform }>(links: T[]): T | undefined {
  for (const p of PRIMARY_ORDER) {
    const hit = links.find((l) => l.platform === p);
    if (hit) return hit;
  }
  return undefined;
}

/** One sheet row → a person, or the reason it cannot be one. */
export function readRow(
  row: ImportCell[],
  mapping: ColumnMapping,
  rowNumber: number,
): { person: ImportPerson } | { rejected: RejectedRow } | { blank: true } {
  const get = (field: ImportField): ImportCell => {
    const i = mapping.indexOf(field);
    return i >= 0 ? row[i] : undefined;
  };
  if (row.every((c) => c == null || String(c).trim() === "")) return { blank: true };

  const links: ImportLink[] = [];
  const problems: string[] = [];
  for (const platform of PRIMARY_ORDER) {
    const f = LINK_FIELDS[platform];
    if (!mapping.includes(f.link)) continue;
    const parsed = parseProfileLink(get(f.link), platform);
    if (parsed.ok) {
      // The column says TikTok, the link can still be an Instagram one; the
      // link wins, and the column's numbers go with it.
      if (links.some((l) => l.platform === parsed.link.platform && l.handle === parsed.link.handle)) continue;
      links.push({
        ...parsed.link,
        followersCount: parseCount(get(f.followers)),
        averageViews: f.views ? parseCount(get(f.views)) : null,
      });
    } else if ("reason" in parsed) {
      problems.push(parsed.reason);
    }
  }

  const rawName = text(get("name"));
  const name = rawName && rawName.toLowerCase() !== "name" ? rawName : null;
  if (!links.length) {
    return {
      rejected: {
        row: rowNumber,
        name: name ?? text(get("email")) ?? `Row ${rowNumber}`,
        reason: problems[0] ?? "No usable profile link",
      },
    };
  }

  const primary = primaryLink(links)!;
  // "Followers" and "Average Views" with no platform in the header describe
  // the primary account (the sign-up sheet's cleaned "Creator Directory" tab).
  if (primary.followersCount === null) primary.followersCount = parseCount(get("followers"));
  if (primary.averageViews === null) primary.averageViews = parseCount(get("avgViews"));

  const email = text(get("email"));
  const niche = text(get("niche"));
  return {
    person: {
      rows: [rowNumber],
      name: (name ?? primary.handle).slice(0, 200),
      email: email && EMAIL.test(email) ? email.toLowerCase() : null,
      country: normalizeCountries(get("country")),
      audienceCountry: normalizeCountries(get("audienceCountry")),
      niche: niche ? niche.slice(0, 500) : null,
      tags: nicheTags(niche),
      rate: parsePrice(get("price")),
      signedUpAt: parseTimestamp(get("signedUpAt")),
      links,
    },
  };
}

function linkKey(l: { platform: string; handle: string }) {
  return `${l.platform}:${l.handle}`;
}

/**
 * The same person, submitted more than once, becomes one: rows that share an
 * email or any account are merged. The latest submission's answers win, and
 * an older one only fills what the newer left blank.
 */
export function mergePeople(people: ImportPerson[]): ImportPerson[] {
  const parent = people.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const seen = new Map<string, number>();
  people.forEach((p, i) => {
    const keys = [...p.links.map(linkKey), ...(p.email ? [`email:${p.email}`] : [])];
    for (const k of keys) {
      const j = seen.get(k);
      if (j === undefined) seen.set(k, i);
      else union(j, i);
    }
  });

  const groups = new Map<number, ImportPerson[]>();
  people.forEach((p, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), p]);
  });

  const merged: ImportPerson[] = [];
  for (const group of groups.values()) {
    // Oldest first, so each later row overwrites; undated rows count as oldest.
    const ordered = [...group].sort(
      (a, b) => (a.signedUpAt?.getTime() ?? 0) - (b.signedUpAt?.getTime() ?? 0) || a.rows[0] - b.rows[0],
    );
    const out: ImportPerson = { ...ordered[0], rows: [], tags: [], links: [] };
    const links = new Map<string, ImportLink>();
    const tags = new Set<string>();
    for (const p of ordered) {
      out.rows.push(...p.rows);
      if (p.name && p.name !== primaryLink(p.links)?.handle) out.name = p.name;
      else if (!out.name) out.name = p.name;
      for (const k of ["email", "country", "audienceCountry", "niche", "rate", "signedUpAt"] as const) {
        if (p[k] !== null) (out as Record<string, unknown>)[k] = p[k];
      }
      for (const t of p.tags) tags.add(t);
      for (const l of p.links) {
        const prev = links.get(linkKey(l));
        links.set(linkKey(l), {
          ...l,
          followersCount: l.followersCount ?? prev?.followersCount ?? null,
          averageViews: l.averageViews ?? prev?.averageViews ?? null,
        });
      }
    }
    out.rows.sort((a, b) => a - b);
    out.links = PRIMARY_ORDER.flatMap((p) => [...links.values()].filter((l) => l.platform === p));
    out.tags = [...tags].sort();
    merged.push(out);
  }
  return merged.sort((a, b) => a.rows[0] - b.rows[0]);
}

export type ParsedSheet = {
  people: ImportPerson[];
  rejected: RejectedRow[];
  /** Rows folded into another person because they were the same one. */
  mergedRows: number;
  totalRows: number;
};

/** A whole sheet: header row first, then data. */
export function parseSheet(rows: ImportCell[][], mapping?: ColumnMapping): ParsedSheet {
  const [header = [], ...data] = rows;
  const map = mapping ?? detectMapping(header);
  const people: ImportPerson[] = [];
  const rejected: RejectedRow[] = [];
  let totalRows = 0;
  data.forEach((row, i) => {
    const result = readRow(row, map, i + 2);
    if ("blank" in result) return;
    totalRows++;
    if ("rejected" in result) rejected.push(result.rejected);
    else people.push(result.person);
  });
  const merged = mergePeople(people);
  return { people: merged, rejected, mergedRows: people.length - merged.length, totalRows };
}
