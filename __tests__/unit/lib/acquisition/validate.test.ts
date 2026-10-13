/**
 * @jest-environment node
 *
 * The one validation gate (plan A3), rule by rule, with readings shaped the
 * way the readers actually return them. Each rule is paired with the
 * legitimate reading closest to it that must still pass: a gate that drops a
 * real number is as wrong as one that lets a bad one through.
 */
import {
  describeVerdict,
  isShellLabel,
  logVerdict,
  sameHandle,
  validateReading,
  withoutDropped,
} from "@/lib/acquisition/validate";

describe("fell-to-zero", () => {
  it("voids a post reading whose views fell to 0 (the 2026-09-19 TikTok case)", () => {
    const v = validateReading(
      { kind: "post", platform: "TIKTOK", counts: { views: 0, likes: 0, comments: 0, shares: 0 } },
      { platform: "TIKTOK", counts: { views: 53_700, likes: 4_100, comments: 88, shares: 31 } },
    );
    expect(v.ok).toBe(false);
    expect(v.rejected).toBe(true);
    expect(v.rejections.map((r) => r.rule)).toContain("fell-to-zero");
    expect(v.rejections.find((r) => r.field === "views")).toMatchObject({ whole: true });
  });

  it("drops only a secondary counter that fell to 0 and lets the rest land", () => {
    const v = validateReading(
      { kind: "post", platform: "TIKTOK", counts: { views: 61_200, likes: 4_300, comments: 0 } },
      { platform: "TIKTOK", counts: { views: 53_700, likes: 4_100, comments: 88 } },
    );
    expect(v.rejected).toBe(false);
    expect(v.dropFields).toEqual(["comments"]);
    expect(
      withoutDropped({ viewsCount: 61_200, likesCount: 4_300, commentsCount: 0 }, v, { comments: "commentsCount" }),
    ).toEqual({ viewsCount: 61_200, likesCount: 4_300 });
  });

  it("voids a creator reading that fell to 0 followers", () => {
    const v = validateReading(
      { kind: "creator", platform: "TIKTOK", counts: { followers: 0, posts: 0 } },
      { platform: "TIKTOK", counts: { followers: 120_000 } },
    );
    expect(v.rejected).toBe(true);
    expect(describeVerdict(v)).toBe("fell-to-zero: followers fell to 0 from 120000");
  });

  it("passes a genuine 0 on a post that never had any (a brand-new post with no likes yet)", () => {
    const v = validateReading(
      { kind: "post", platform: "INSTAGRAM", counts: { views: 312, likes: 0, comments: 0 } },
      { platform: "INSTAGRAM", counts: { views: 0, likes: 0, comments: 0 } },
    );
    expect(v.ok).toBe(true);
  });

  it("passes a first reading of 0 (no previous figure to fall from)", () => {
    expect(validateReading({ kind: "sound", platform: "TIKTOK", counts: { uses: 0 } }, {}).ok).toBe(true);
  });

  it("passes a real drop in views after a platform correction (lower, but not 0)", () => {
    // YouTube's 2026-08-27 view-definition change and spam-view purges move a
    // lifetime count DOWN. That is a surprise for a second read to confirm,
    // never a hard reject.
    const v = validateReading(
      { kind: "post", platform: "YOUTUBE", counts: { views: 41_000, likes: 2_900, comments: 140 } },
      { platform: "YOUTUBE", counts: { views: 98_000, likes: 3_000, comments: 141 } },
    );
    expect(v.ok).toBe(true);
  });

  it("treats an absent counter as unread, never as a fall to 0 (YouTube publishes no shares)", () => {
    const v = validateReading(
      { kind: "post", platform: "YOUTUBE", counts: { views: 120_000, likes: 8_000, comments: 400, shares: undefined } },
      { platform: "YOUTUBE", counts: { views: 118_000, likes: 7_900, comments: 390, shares: 1_250 } },
    );
    expect(v.ok).toBe(true);
    expect(v.dropFields).toEqual([]);
  });

  it("passes YouTube shares from the owner's analytics when they sit under views", () => {
    const v = validateReading(
      { kind: "post", platform: "YOUTUBE", counts: { views: 120_000, likes: 8_000, shares: 1_300 } },
      { platform: "YOUTUBE", counts: { views: 118_000, likes: 7_900, shares: 1_250 } },
    );
    expect(v.ok).toBe(true);
  });

  it("passes a hidden Instagram like count (omitted, not 0)", () => {
    const v = validateReading(
      { kind: "post", platform: "INSTAGRAM", counts: { views: 9_000, comments: 40 } },
      { platform: "INSTAGRAM", counts: { views: 8_800, likes: 610, comments: 39 } },
    );
    expect(v.ok).toBe(true);
  });

  it("ignores a stored value the caller did not load", () => {
    expect(validateReading({ kind: "post", counts: { views: 0 } }, {}).ok).toBe(true);
  });
});

describe("engagement-exceeds-views", () => {
  it("voids a reading with more likes than views (the neighbouring-video parse)", () => {
    const v = validateReading({ kind: "post", platform: "TIKTOK", counts: { views: 313, likes: 1_088, comments: 12 } });
    expect(v.rejected).toBe(true);
    expect(v.rejections[0]).toMatchObject({ rule: "engagement-exceeds-views", whole: true });
    expect(v.rejections[0].detail).toBe("likes 1088 over views 313");
  });

  it("applies to saves and shares too", () => {
    expect(validateReading({ kind: "post", counts: { views: 100, saves: 101 } }).rejected).toBe(true);
    expect(validateReading({ kind: "post", counts: { views: 100, shares: 400 } }).rejected).toBe(true);
  });

  it("passes when views were not read (an Instagram photo has no view count)", () => {
    expect(validateReading({ kind: "post", platform: "INSTAGRAM", counts: { likes: 5_000, comments: 80 } }).ok).toBe(true);
  });

  it("passes likes equal to views", () => {
    expect(validateReading({ kind: "post", counts: { views: 12, likes: 12 } }).ok).toBe(true);
  });

  it("checks each item of a top-posts list the same way", () => {
    expect(validateReading({ kind: "top-post", platform: "TIKTOK", counts: { views: 1, likes: 0, comments: 0 } }).ok).toBe(true);
    expect(validateReading({ kind: "top-post", platform: "TIKTOK", counts: { views: 900, likes: 1_092 } }).rejected).toBe(true);
  });
});

describe("platform-mismatch", () => {
  it("voids an Instagram author's follower count landing on a TikTok creator", () => {
    const v = validateReading(
      { kind: "creator", platform: "INSTAGRAM", counts: { followers: 48_000 } },
      { platform: "TIKTOK", counts: { followers: 1_600_000 } },
    );
    expect(v.rejected).toBe(true);
    expect(v.rejections[0]).toMatchObject({ rule: "platform-mismatch", detail: "INSTAGRAM reading for a TIKTOK row" });
  });

  it("compares case-insensitively and passes the same platform", () => {
    expect(validateReading({ kind: "post", platform: "tiktok", counts: { views: 1 } }, { platform: "TIKTOK" }).ok).toBe(true);
  });

  it("does not apply when either side did not say", () => {
    expect(validateReading({ kind: "post", counts: { views: 1 } }, { platform: "TIKTOK" }).ok).toBe(true);
    expect(validateReading({ kind: "post", platform: "TIKTOK", counts: { views: 1 } }, {}).ok).toBe(true);
  });
});

describe("account-mismatch", () => {
  it("voids a reading of a different account under a bound handle", () => {
    const v = validateReading(
      { kind: "creator", platform: "TIKTOK", accountId: "7300000000000000002", counts: { followers: 900 } },
      { platform: "TIKTOK", boundAccountIds: ["6800000000000000001"], counts: { followers: 52_000 } },
    );
    expect(v.rejected).toBe(true);
    expect(v.rejections[0].rule).toBe("account-mismatch");
  });

  it("passes the bound account, renamed or not", () => {
    const v = validateReading(
      { kind: "creator", platform: "TIKTOK", accountId: "6800000000000000001", counts: { followers: 52_400 } },
      { platform: "TIKTOK", boundAccountIds: ["6800000000000000001"], counts: { followers: 52_000 } },
    );
    expect(v.ok).toBe(true);
  });

  it("does not apply without a binding, or when the reading carried no id", () => {
    expect(validateReading({ kind: "creator", accountId: "1", counts: { followers: 5 } }, { boundAccountIds: [] }).ok).toBe(true);
    expect(validateReading({ kind: "creator", accountId: "1", counts: { followers: 5 } }, { boundAccountIds: null }).ok).toBe(true);
    expect(validateReading({ kind: "creator", counts: { followers: 5 } }, { boundAccountIds: ["2"] }).ok).toBe(true);
  });
});

describe("parser-shell", () => {
  it("voids a reading whose reader said it parsed a shell", () => {
    expect(validateReading({ kind: "creator", shell: true, counts: { followers: 0 } }).rejected).toBe(true);
  });

  it("voids a reading whose title is a WAF or login page", () => {
    expect(validateReading({ kind: "sound", labels: ["TikTok - Make Your Day"], counts: { uses: 0 } }).rejected).toBe(true);
    expect(validateReading({ kind: "sound", labels: ['<!DOCTYPE html><html lang="en">'], counts: { uses: 12 } }).rejected).toBe(true);
    expect(validateReading({ kind: "sound", labels: ["Please wait... SlardarWAF"], counts: { uses: 12 } }).rejected).toBe(true);
    expect(validateReading({ kind: "creator", labels: ["Login • Instagram"], counts: { followers: 3 } }).rejected).toBe(true);
  });

  it("passes a real song whose title happens to share words with a challenge page", () => {
    expect(isShellLabel("Just a moment (feat. Lil Baby)")).toBe(false);
    expect(isShellLabel("captcha")).toBe(false);
    expect(isShellLabel("original sound - leakit.official")).toBe(false);
    expect(validateReading({ kind: "sound", labels: ["Just a moment (feat. Lil Baby)", null], counts: { uses: 46 } }).ok).toBe(true);
  });
});

describe("helpers", () => {
  it("sameHandle ignores @ and case, and never matches an empty handle", () => {
    expect(sameHandle("@LeakIt.Official", "leakit.official")).toBe(true);
    expect(sameHandle("leakit", "leak_it")).toBe(false);
    expect(sameHandle("", "")).toBe(false);
    expect(sameHandle(null, undefined)).toBe(false);
  });

  it("logVerdict writes one structured warn line for a refusal and nothing above debug for a pass", () => {
    const writes: string[] = [];
    const spy = jest.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    const prev = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "info";
    try {
      logVerdict({ writer: "post-sync", kind: "post", platform: "TIKTOK", rowId: "post_1" }, validateReading({ kind: "post", counts: { views: 5 } }));
      logVerdict(
        { writer: "post-sync", kind: "post", platform: "TIKTOK", rowId: "post_1" },
        validateReading({ kind: "post", counts: { views: 0 } }, { counts: { views: 9 } }),
      );
    } finally {
      process.env.LOG_LEVEL = prev;
      spy.mockRestore();
    }
    expect(writes).toHaveLength(1);
    const line = JSON.parse(writes[0]);
    expect(line).toMatchObject({
      level: "warn",
      msg: "reading rejected",
      context: {
        gate: "acquisition.validate",
        writer: "post-sync",
        kind: "post",
        rowId: "post_1",
        rules: ["fell-to-zero"],
        fields: ["views"],
        reason: "fell-to-zero: views fell to 0 from 9",
      },
    });
  });
});
