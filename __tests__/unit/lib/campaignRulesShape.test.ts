import {
  EMPTY_RULES,
  normaliseHashtag,
  normaliseMention,
  parseRulesInput,
  rulesAreEmpty,
  scheduledUntil,
  viewGoalProgress,
} from "@/lib/campaigns/rulesShape";

describe("normaliseHashtag / normaliseMention", () => {
  it("adds the sign, lower-cases, and drops spaces", () => {
    expect(normaliseHashtag("SummerDrop")).toBe("#summerdrop");
    expect(normaliseHashtag("##Summer Drop")).toBe("#summerdrop");
    expect(normaliseMention("@Brand.Official")).toBe("@brand.official");
    expect(normaliseMention("brand_x")).toBe("@brand_x");
  });

  it("refuses what cannot be a tag or handle", () => {
    expect(normaliseHashtag("#")).toBeNull();
    expect(normaliseHashtag("#a-b")).toBeNull();
    expect(normaliseMention("@")).toBeNull();
    expect(normaliseMention("a/b")).toBeNull();
  });
});

describe("parseRulesInput", () => {
  it("reads an empty body as no rules", () => {
    const { rules, errors } = parseRulesInput({});
    expect(errors).toEqual([]);
    expect(rules).toEqual(EMPTY_RULES);
    expect(rulesAreEmpty(rules)).toBe(true);
  });

  it("trims, dedupes case-insensitively, and drops blank list items", () => {
    const { rules } = parseRulesInput({ dos: ["  Use the sound ", "use the sound", "", "Tag us"] });
    expect(rules.dos).toEqual(["Use the sound", "Tag us"]);
  });

  it("splits tags typed on one line and normalises each", () => {
    const { rules, errors } = parseRulesInput({ requiredHashtags: ["#Drop, summer #Drop"], requiredMentions: ["Brand"] });
    expect(errors).toEqual([]);
    expect(rules.requiredHashtags).toEqual(["#drop", "#summer"]);
    expect(rules.requiredMentions).toEqual(["@brand"]);
  });

  it("names each field it could not read", () => {
    const { errors } = parseRulesInput({
      minFollowers: "lots",
      maxPostsPerAccount: 0,
      viewGoal: -5,
      examplePostUrls: ["javascript:alert(1)"],
      launchAt: "someday",
      requiredHashtags: ["#ok", "#not-ok"],
    });
    expect(errors.join(" | ")).toMatch(/Minimum followers/);
    expect(errors.join(" | ")).toMatch(/Posts per account/);
    expect(errors.join(" | ")).toMatch(/View goal/);
    expect(errors.join(" | ")).toMatch(/Example posts/);
    expect(errors.join(" | ")).toMatch(/Launch date/);
    expect(errors.join(" | ")).toMatch(/#not-ok/);
  });

  it("accepts numbers typed with separators, and only http(s) example links", () => {
    const { rules, errors } = parseRulesInput({
      minFollowers: "10,000",
      viewGoal: "1 000 000",
      examplePostUrls: ["https://www.tiktok.com/@a/video/1"],
    });
    expect(errors).toEqual([]);
    expect(rules.minFollowers).toBe(10_000);
    expect(rules.viewGoal).toBe(1_000_000);
    expect(rules.examplePostUrls).toEqual(["https://www.tiktok.com/@a/video/1"]);
  });

  it("caps each list at its limit and says so", () => {
    const { rules, errors } = parseRulesInput({ examplePostUrls: Array.from({ length: 7 }, (_, i) => `https://x.test/${i}`) });
    expect(rules.examplePostUrls).toHaveLength(5);
    expect(errors.join(" ")).toMatch(/at most 5/);
  });
});

describe("scheduledUntil", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  it("is the launch date while it is still ahead, and null once it has passed", () => {
    expect(scheduledUntil({ launchAt: "2026-11-02T00:00:00.000Z" }, now)).toBe("2026-11-02T00:00:00.000Z");
    expect(scheduledUntil({ launchAt: "2026-10-29T00:00:00.000Z" }, now)).toBeNull();
    expect(scheduledUntil({ launchAt: null }, now)).toBeNull();
    expect(scheduledUntil(null, now)).toBeNull();
  });
});

describe("viewGoalProgress", () => {
  it("is null without a goal or without a measured total", () => {
    expect(viewGoalProgress(500, null)).toBeNull();
    expect(viewGoalProgress(500, 0)).toBeNull();
    expect(viewGoalProgress(null, 1000)).toBeNull();
  });

  it("rounds the percentage and says when the goal is reached", () => {
    expect(viewGoalProgress(333, 1000)).toEqual({ pct: 33, reached: false });
    expect(viewGoalProgress(1_380_000, 1_000_000)).toEqual({ pct: 138, reached: true });
  });
});
