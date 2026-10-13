import {
  MAPPABLE_FIELDS,
  METRIC_FIELDS,
  detectMapping,
  isMetricHeader,
  isSignupFormMapping,
  mergePeople,
  nicheTags,
  normalizeCountries,
  parseCount,
  parsePrice,
  parseProfileLink,
  parseSheet,
  parseTimestamp,
  personName,
  readRow,
  type ImportCell,
} from "@/lib/creators/importParse";
import { LEGACY_CELL_RULES } from "@/lib/creators/importParseLegacy";

/* Every input here is made up, but each is the SHAPE of an answer found in
   LKAY Media's real sign-up sheet (1,239 rows, measured 2026-09-28). The real
   rows are client data and do not belong in the repo. */

const SIGNUP_HEADERS = [
  "TIme", "Email Address", "Name", "Email", "Country", "Niche",
  "Tiktok Followers", "Titkok Link", "Average Views(Tiktok)",
  "Instagram Followers", "Instagram Link", "Average Views(IG)",
  "Youtube Subscribers", "Youtube Link", "Average Views (Youtube)",
  "Country of Audience", "Price for a Video(in $)",
];

function signupRow(over: Partial<Record<string, ImportCell>> = {}): ImportCell[] {
  const base: Record<string, ImportCell> = {
    "TIme": 45566.8, "Email Address": "login@example.com", "Name": "Aki Edits", "Email": "aki@example.com",
    "Country": "Brasil", "Niche": "Anime, Naruto, Demon Slayer",
    "Tiktok Followers": "391,9k", "Titkok Link": "https://www.tiktok.com/@AkiEdits?_t=8qky", "Average Views(Tiktok)": "40k",
    "Instagram Followers": "12.5k", "Instagram Link": "https://www.instagram.com/aki.edits/", "Average Views(IG)": "3k",
    "Youtube Subscribers": "", "Youtube Link": "I don't have", "Average Views (Youtube)": "",
    "Country of Audience": "USA", "Price for a Video(in $)": "25",
  };
  const merged = { ...base, ...over };
  return SIGNUP_HEADERS.map((h) => merged[h] ?? null);
}

describe("parseProfileLink", () => {
  it.each([
    ["https://www.tiktok.com/@AkiEdits?_t=8qky&_r=1", "TIKTOK", "akiedits"],
    ["tiktok.com/@aki.edits", "TIKTOK", "aki.edits"],
    ["tiktok.com/flurry.x", "TIKTOK", "flurry.x"],
    ["https://www.instagram.com/aki.edits/?igsh=abc==", "INSTAGRAM", "aki.edits"],
    ["instagram.com/aki_edits", "INSTAGRAM", "aki_edits"],
    ["https://www.youtube.com/@AkiEdits", "YOUTUBE", "akiedits"],
    ["https://www.youtube.com/channel/UC5wlwBkabcdefghijklmnop", "YOUTUBE", "UC5wlwBkabcdefghijklmnop"],
    ["https://x.com/AkiEdits", "TWITTER", "akiedits"],
  ])("reads %s", (raw, platform, handle) => {
    const r = parseProfileLink(raw);
    expect(r).toEqual({ ok: true, link: expect.objectContaining({ platform, handle }) });
  });

  it("takes a bare handle when the column names the platform", () => {
    expect(parseProfileLink("@Aki.Edits", "TIKTOK")).toEqual({
      ok: true,
      link: { platform: "TIKTOK", handle: "aki.edits", url: "https://www.tiktok.com/@aki.edits" },
    });
  });

  it("finds the link inside a sentence, and the first of two pasted together", () => {
    const sentence = parseProfileLink("I'm on Instagram as @aki. Follow me https://www.instagram.com/aki.edits/ thanks");
    expect(sentence).toMatchObject({ ok: true, link: { handle: "aki.edits" } });
    const glued = parseProfileLink("https://www.instagram.com/first_onehttps://www.instagram.com/second");
    expect(glued).toMatchObject({ ok: true, link: { handle: "first_one" } });
  });

  it.each(["N/A", "None", "0.0", "-", "/", "I don't have", "No channel", "нет", ""])(
    "reads %p as no account, not an error",
    (raw) => {
      expect(parseProfileLink(raw, "YOUTUBE")).toEqual({ ok: false, empty: true });
    },
  );

  it("refuses post links and short links with a reason", () => {
    expect(parseProfileLink("https://www.instagram.com/p/Cxyz123/")).toMatchObject({ ok: false, reason: expect.stringMatching(/isn't a profile/) });
    expect(parseProfileLink("https://vt.tiktok.com/ZSabc/")).toMatchObject({ ok: false, reason: expect.stringMatching(/Short link/) });
    expect(parseProfileLink("https://linktr.ee/aki")).toMatchObject({ ok: false, reason: expect.stringMatching(/Not a profile link/) });
  });
});

describe("parseCount", () => {
  it.each([
    ["391,9k", 391900],
    ["456.1k", 456100],
    ["460K", 460000],
    ["477 000", 477000],
    ["477.000", 477000],
    ["1,234,567", 1234567],
    ["1.2M", 1200000],
    ["500-10k", 5250],
    ["10k to 20k", 15000],
    ["~50k+", 50000],
    [6600000, 6600000],
    // Thousands with the "k" dropped, or a European "17.300" the sheet read as 17.3.
    [17.3, 17300],
    [69.225, 69225],
    ["19,3", 19300],
    ["164,93", 164930],
    [67766.2, 67766],
    [800, 800],
    // "mil" is the Spanish and Portuguese thousand; the other units in other words.
    ["31,2 mil", 31200],
    ["543mil", 543000],
    ["2 milhões", 2000000],
    ["1 millón de folowers", 1000000],
    ["1 millions of followers on TikTok", 1000000],
    ["284 thousands", 284000],
    ["19Thousand", 19000],
    ["13.075.000 Millions", 13075000],
    ["11k6", 11600],
    ["168+.k", 168000],
    ["24000Followers", 24000],
    ["150k of followers", 150000],
    ["20k above", 20000],
    ["Almost 3k", 3000],
    ["average 50k views", 50000],
    ["404K (old video)", 404000],
    ["80 (don't post here anymore)", 80],
    ["1,29,600", 129600],
    // A bare lower bound takes the upper bound's unit only when it must.
    ["50-100k", 75000],
    ["8 to 10k", 9000],
    ["40-50000", 45000],
    ["20/30k", 25000],
    ["10k or 100k", 55000],
    ["300-500", 400],
  ])("reads %p as %p", (raw, n) => {
    expect(parseCount(raw)).toBe(n);
  });

  it.each(["", "N/A", "none", "a lot", null, undefined, "0 (I'm not posting)", "40(for a lot songs) 60(for few)", "350.000.232.990", "I don't post on YouTube"])(
    "reads %p as unknown, never 0",
    (raw) => {
      expect(parseCount(raw as never)).toBeNull();
    },
  );
});

describe("parsePrice, parseTimestamp", () => {
  it("reads prices, ranges and refusals", () => {
    expect(parsePrice("$25")).toBe(25);
    expect(parsePrice("20-30")).toBe(25);
    expect(parsePrice(12.5)).toBe(12.5);
    expect(parsePrice("negotiable")).toBeNull();
    expect(parsePrice("0")).toBeNull();
  });

  it.each([
    ["10 dollars", 10],
    ["10 dólares", 10],
    ["15$ per post", 15],
    ["$10 per post", 10],
    ["5$/video", 5],
    ["12.5 Dollar", 12.5],
    ["15 or 20", 17.5],
    ["40/30", 35],
    ["13/26$", 19.5],
    ["$15/$35", 25],
    ["8-10 (cuz of fees)", 9],
    ["11-15 Euro", 13],
    ["£7", 7],
    ["500 INR (6-7$)", 6.5],
    ["6$ or 500 inr", 6],
  ])("reads the price %p as %p dollars", (raw, n) => {
    expect(parsePrice(raw)).toBe(n);
  });

  it.each(["700 rupees", "500 to 700₹", "₹500"])("leaves %p unknown rather than reading rupees as dollars", (raw) => {
    expect(parsePrice(raw)).toBeNull();
  });

  it("reads an Excel serial day as a date", () => {
    expect(parseTimestamp(45566.5)?.toISOString()).toBe("2024-10-01T12:00:00.000Z");
    expect(parseTimestamp("not a date")).toBeNull();
  });
});

describe("nicheTags, normalizeCountries", () => {
  it("maps free text onto the short tag set and leaves the tail untagged", () => {
    expect(nicheTags("Attack On Titan, Naruto, football edits").sort()).toEqual(["Anime", "Football"]);
    expect(nicheTags("lyrics / kpop")).toEqual(expect.arrayContaining(["Lyrics", "K-pop"]));
    expect(nicheTags("aesthetic slowed reverb")).toEqual([]);
  });

  it("spells a country one way and drops non-answers", () => {
    expect(normalizeCountries("Usa")).toBe("United States");
    expect(normalizeCountries("brasil")).toBe("Brazil");
    expect(normalizeCountries("USA, Brazil")).toBe("United States, Brazil");
    expect(normalizeCountries("Other")).toBeNull();
    expect(normalizeCountries("Worldwide")).toBeNull();
  });

  it.each([
    ["Indonésia, Tailândia", "Indonesia, Thailand"],
    ["República dominicana", "Dominican Republic"],
    ["Other (48%) Mexico (17.1%)", "Mexico"],
    ["1.Mexico  2.Brazil  3.USA", "Mexico, Brazil, United States"],
    ["USA Brazil Others", "United States, Brazil"],
    ["Brasil/USA (top1/2)", "Brazil, United States"],
    ["Indonesian", "Indonesia"],
    ["EE.UU", "United States"],
    ["Kazachstan", "Kazakhstan"],
    ["Philippines/ canda", "Philippines, Canada"],
    ["united stated and mexico", "United States, Mexico"],
    ["Russia , Ukraine and the whole of Europe", "Russia, Ukraine, Europe"],
    ["Mostly Asean", "Southeast Asia"],
    ["Россия", "Russia"],
    ["🇺🇸", "United States"],
    ["Rio de Janeiro", "Rio De Janeiro"],
    ["Nova Iguaçu", "Nova Iguaçu"],
  ])("reads %p as %p", (raw, out) => {
    expect(normalizeCountries(raw)).toBe(out);
  });

  it.each(["Idk", "there are several", "Whole world", "All over the world", "4.6 views", "Randy829217", "It says other so idk"])(
    "reads %p as no country",
    (raw) => {
      expect(normalizeCountries(raw)).toBeNull();
    },
  );
});

describe("personName", () => {
  it("keeps the name and drops the email, link or handle typed with it", () => {
    expect(personName("Aki Edits (@aki.edits)")).toBe("Aki Edits");
    expect(personName("Aki (@aki_edits)")).toBe("Aki");
    expect(personName("Aki Edits https://www.tiktok.com/@aki")).toBe("Aki Edits");
  });

  it.each(["aki2024@example.com", "@aki.edits", "Name", "N/A"])("reads %p as no name, so the handle stands in", (raw) => {
    expect(personName(raw)).toBeNull();
  });
});

describe("LEGACY_CELL_RULES", () => {
  it("still reads cells exactly as the first import did", () => {
    expect(LEGACY_CELL_RULES.count(17.3)).toBe(17);
    expect(LEGACY_CELL_RULES.count("31,2 mil")).toBe(31200000);
    expect(LEGACY_CELL_RULES.count("50-100k")).toBe(50025);
    expect(LEGACY_CELL_RULES.price("10 dollars")).toBeNull();
    expect(LEGACY_CELL_RULES.countries("Indonésia")).toBe("IndonÉSia");
    expect(LEGACY_CELL_RULES.name("aki2024@example.com")).toBe("aki2024@example.com");
  });
});

describe("detectMapping", () => {
  it("recognises the sign-up form, typed Email over the form login", () => {
    const m = detectMapping(SIGNUP_HEADERS);
    expect(m[SIGNUP_HEADERS.indexOf("Email")]).toBe("email");
    expect(m[SIGNUP_HEADERS.indexOf("Email Address")]).toBeNull();
    expect(m[SIGNUP_HEADERS.indexOf("Titkok Link")]).toBe("tiktokLink");
    // Follower and view columns are left unmapped: figures come from the platforms.
    for (const h of ["Tiktok Followers", "Average Views(Tiktok)", "Instagram Followers", "Average Views(IG)", "Youtube Subscribers", "Average Views (Youtube)"]) {
      expect(m[SIGNUP_HEADERS.indexOf(h)]).toBeNull();
    }
    expect(m[SIGNUP_HEADERS.indexOf("Country of Audience")]).toBe("audienceCountry");
    expect(m[SIGNUP_HEADERS.indexOf("Country")]).toBe("country");
    expect(isSignupFormMapping(m)).toBe(true);
  });

  it("never maps a metric column, and keeps one from being claimed as something else", () => {
    const headers = ["Name", "TikTok link", "Followers", "Average views", "Engagement rate", "Total likes", "Rate per video"];
    expect(detectMapping(headers)).toEqual(["name", "tiktokLink", null, null, null, null, "price"]);
    expect(headers.map(isMetricHeader)).toEqual([false, false, true, true, true, true, false]);
    // Form questions that only look like figures stay ordinary columns.
    expect(["Any comments?", "How can we reach you?", "What do you like?", "Overview"].map(isMetricHeader)).toEqual([false, false, false, false]);
  });

  it("offers no metric field to map a column to", () => {
    expect(MAPPABLE_FIELDS.some((f) => METRIC_FIELDS.has(f))).toBe(false);
    expect(MAPPABLE_FIELDS).toContain("tiktokLink");
  });

  it("prefers Artist Name over Legal Name", () => {
    const m = detectMapping(["Legal Name", "Artist Name", "Youtube Link"]);
    expect(m).toEqual([null, "name", "youtubeLink"]);
  });
});

describe("readRow", () => {
  const mapping = detectMapping(SIGNUP_HEADERS);

  it("builds one person with an account per platform, TikTok first", () => {
    const r = readRow(signupRow(), mapping, 2);
    if (!("person" in r)) throw new Error("expected a person");
    expect(r.person).toMatchObject({
      name: "Aki Edits",
      email: "aki@example.com",
      country: "Brazil",
      audienceCountry: "United States",
      rate: 25,
      tags: expect.arrayContaining(["Anime"]),
    });
    // Accounts only: the follower and view cells beside them are not read.
    expect(r.person.links).toEqual([
      { platform: "TIKTOK", handle: "akiedits", url: "https://www.tiktok.com/@akiedits" },
      { platform: "INSTAGRAM", handle: "aki.edits", url: "https://www.instagram.com/aki.edits/" },
    ]);
  });

  it("reads no counts even when a mapping still names a metric column", () => {
    const old = [...mapping];
    old[SIGNUP_HEADERS.indexOf("Tiktok Followers")] = "tiktokFollowers";
    old[SIGNUP_HEADERS.indexOf("Average Views(IG)")] = "instagramAvgViews";
    const r = readRow(signupRow(), old, 2);
    if (!("person" in r)) throw new Error("expected a person");
    for (const l of r.person.links) {
      expect(l).not.toHaveProperty("followersCount");
      expect(l).not.toHaveProperty("averageViews");
    }
  });

  it("falls back to the handle when the name is the placeholder", () => {
    const r = readRow(signupRow({ Name: "Name" }), mapping, 2);
    expect("person" in r && r.person.name).toBe("akiedits");
  });

  it("rejects a row with no usable link, and says why", () => {
    const r = readRow(
      signupRow({ "Titkok Link": "https://vm.tiktok.com/ZMabc/", "Instagram Link": "N/A", "Youtube Link": "" }),
      mapping,
      7,
    );
    expect(r).toEqual({ rejected: { row: 7, name: "Aki Edits", reason: expect.stringMatching(/Short link/) } });
  });

  it("skips a blank row", () => {
    expect(readRow(SIGNUP_HEADERS.map(() => ""), mapping, 3)).toEqual({ blank: true });
  });
});

describe("mergePeople", () => {
  const mapping = detectMapping(SIGNUP_HEADERS);
  const person = (over: Partial<Record<string, ImportCell>>, row: number) => {
    const r = readRow(signupRow(over), mapping, row);
    if (!("person" in r)) throw new Error("expected a person");
    return r.person;
  };

  it("merges repeat submissions by account or email, the latest winning", () => {
    const older = person({ TIme: 45500, "Price for a Video(in $)": "10", "Country of Audience": "India" }, 2);
    const newer = person({ TIme: 45600, "Price for a Video(in $)": "30", "Country of Audience": "", Email: "other@example.com" }, 9);
    const byEmail = person({ TIme: 45550, "Titkok Link": "https://www.tiktok.com/@different", "Instagram Link": "", Email: "other@example.com", "Country of Audience": "" }, 5);
    const merged = mergePeople([older, newer, byEmail]);
    expect(merged).toHaveLength(1);
    expect(merged[0].rows).toEqual([2, 5, 9]);
    expect(merged[0].rate).toBe(30);
    // The newest left it blank, so the older answer survives.
    expect(merged[0].audienceCountry).toBe("India");
    expect(merged[0].links.map((l) => l.handle)).toEqual(expect.arrayContaining(["akiedits", "different", "aki.edits"]));
  });

  it("keeps different people apart", () => {
    const a = person({}, 2);
    const b = person({ Email: "b@example.com", "Titkok Link": "tiktok.com/@bee", "Instagram Link": "" }, 3);
    expect(mergePeople([a, b])).toHaveLength(2);
  });
});

describe("parseSheet", () => {
  it("counts rows, people, merges and rejections", () => {
    const result = parseSheet([
      SIGNUP_HEADERS,
      signupRow(),
      signupRow({ TIme: 45600 }),
      signupRow({ Email: "c@example.com", "Titkok Link": "N/A", "Instagram Link": "", "Youtube Link": "" }),
      SIGNUP_HEADERS.map(() => null),
    ]);
    expect(result).toMatchObject({ totalRows: 3, mergedRows: 1, people: [expect.any(Object)], rejected: [expect.objectContaining({ row: 4 })] });
  });
});
