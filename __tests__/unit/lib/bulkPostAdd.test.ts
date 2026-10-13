/**
 * @jest-environment node
 *
 * The Add posts dialog's batch rules (lib/posts/bulkAdd). The failure these pin
 * was measured: past about ten links an add outlived the dialog's 25s wait,
 * the dialog said "not added", and the server saved the post anyway -- while
 * the dialog had already moved on and was running a second add beside it.
 */
import {
  ADD_GROUP_SIZE,
  SETTLE_POLL_DELAYS_MS,
  addProgressText,
  addRunReasonsText,
  addRunSummaryText,
  combineVerdicts,
  groupIndices,
  platformLanes,
  postIsLink,
  runInLanes,
  ADD_PLATFORM_LANES,
  settleVerdict,
  summariseAddRun,
  unansweredRowMessage,
  verdictFromPostList,
  verdictFromPrecheck,
  type SaveVerdict,
} from "@/lib/posts/bulkAdd";

const TT = "https://www.tiktok.com/@fake.creator.one/video/7000000000000000001";
const TT_SHARED = `${TT}?is_from_webapp=1&sender_device=pc&web_id=123`;
const IG = "https://www.instagram.com/reel/FAKEreel001/";

describe("groupIndices", () => {
  it("cuts 37 links into groups of at most ten, in order", () => {
    const ids = Array.from({ length: 37 }, (_, i) => i);
    const groups = groupIndices(ids);
    expect(ADD_GROUP_SIZE).toBe(10);
    expect(groups.map((g) => g.length)).toEqual([10, 10, 10, 7]);
    expect(groups.flat()).toEqual(ids);
  });

  it("gives one group for a short paste and none for an empty one", () => {
    expect(groupIndices([4, 9])).toEqual([[4, 9]]);
    expect(groupIndices([])).toEqual([]);
  });

  it("never loops on a nonsense size", () => {
    expect(groupIndices([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
  });
});

describe("postIsLink", () => {
  it("matches the exact link our own add stored", () => {
    expect(postIsLink({ postUrl: TT, platformPostId: "7000000000000000001" }, TT)).toBe(true);
  });

  it("matches the same post sent from a differently decorated share link", () => {
    expect(postIsLink({ postUrl: TT, platformPostId: "7000000000000000001" }, TT_SHARED)).toBe(true);
  });

  it("matches a post whose first read failed, which stores the link as its id", () => {
    // The add route writes platformPostId = postUrl, and platform = TIKTOK, when
    // metrics come back empty -- whatever platform the link was.
    expect(postIsLink({ postUrl: IG, platformPostId: IG }, IG)).toBe(true);
  });

  it("does not match a different post", () => {
    expect(
      postIsLink(
        { postUrl: "https://www.tiktok.com/@fake.creator.two/video/7000000000000000002", platformPostId: "7000000000000000002" },
        TT,
      ),
    ).toBe(false);
  });
});

describe("verdicts", () => {
  it("reads the precheck's inThisCampaign", () => {
    expect(verdictFromPrecheck({ results: [{ url: TT, inThisCampaign: { id: "p1" } }] }, TT)).toBe("saved");
    expect(verdictFromPrecheck({ results: [{ url: TT, inThisCampaign: null }] }, TT)).toBe("absent");
  });

  it("treats a precheck that did not answer for this link as unknown, never absent", () => {
    expect(verdictFromPrecheck(null, TT)).toBe("unknown");
    expect(verdictFromPrecheck({ results: [] }, TT)).toBe("unknown");
    expect(verdictFromPrecheck({ results: [{ url: IG, inThisCampaign: null }] }, TT)).toBe("unknown");
  });

  it("reads the post list", () => {
    expect(verdictFromPostList([{ postUrl: TT, platformPostId: TT }], TT)).toBe("saved");
    expect(verdictFromPostList([], TT)).toBe("absent");
    expect(verdictFromPostList(null, TT)).toBe("unknown");
  });

  it("combines: saved beats absent beats unknown", () => {
    expect(combineVerdicts(["unknown", "absent", "saved"])).toBe("saved");
    expect(combineVerdicts(["unknown", "absent"])).toBe("absent");
    expect(combineVerdicts(["unknown"])).toBe("unknown");
    expect(combineVerdicts([])).toBe("unknown");
  });
});

describe("settleVerdict", () => {
  const noSleep = jest.fn(async () => {});
  beforeEach(() => noSleep.mockClear());

  function sequence(...answers: SaveVerdict[]) {
    const check = jest.fn(async () => answers.shift() ?? "absent");
    return check;
  }

  it("calls a row saved as soon as the server has it, and stops asking", async () => {
    const check = sequence("absent", "absent", "saved");
    const finalCheck = jest.fn(async (): Promise<SaveVerdict> => "absent");
    await expect(settleVerdict(check, { delays: SETTLE_POLL_DELAYS_MS, sleep: noSleep, finalCheck })).resolves.toBe("saved");
    expect(check).toHaveBeenCalledTimes(3);
    expect(finalCheck).not.toHaveBeenCalled();
    expect(noSleep.mock.calls.map((c) => (c as unknown[])[0])).toEqual(SETTLE_POLL_DELAYS_MS.slice(0, 3));
  });

  it("keeps asking through 'absent' -- an add still in its platform read has not written yet", async () => {
    const check = sequence();
    const finalCheck = jest.fn(async (): Promise<SaveVerdict> => "absent");
    await expect(settleVerdict(check, { delays: SETTLE_POLL_DELAYS_MS, sleep: noSleep, finalCheck })).resolves.toBe("absent");
    expect(check).toHaveBeenCalledTimes(SETTLE_POLL_DELAYS_MS.length);
    expect(finalCheck).toHaveBeenCalledTimes(1);
  });

  it("takes the second opinion's 'saved' over every 'absent' before it", async () => {
    const check = sequence();
    const finalCheck = jest.fn(async (): Promise<SaveVerdict> => "saved");
    await expect(settleVerdict(check, { delays: [0, 10], sleep: noSleep, finalCheck })).resolves.toBe("saved");
  });

  it("gives up early on a server it cannot reach, and does not call that absent", async () => {
    const check = sequence("unknown", "unknown");
    const finalCheck = jest.fn(async (): Promise<SaveVerdict> => "unknown");
    await expect(settleVerdict(check, { delays: SETTLE_POLL_DELAYS_MS, sleep: noSleep, finalCheck })).resolves.toBe("unknown");
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("asks once, without waiting, when the server has already answered", async () => {
    const check = sequence("absent");
    await expect(settleVerdict(check, { delays: [0], sleep: noSleep })).resolves.toBe("absent");
    expect(noSleep).not.toHaveBeenCalled();
  });

  it("totals about a minute and a half of waiting", () => {
    const total = SETTLE_POLL_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(60_000);
    expect(total).toBeLessThanOrEqual(120_000);
  });
});

describe("unansweredRowMessage", () => {
  it("says 'not added' only when the server confirmed it is absent", () => {
    expect(unansweredRowMessage("timeout", "absent")).toBe(
      "No answer in 25s, and it is not in the campaign — not added. Submit again to retry.",
    );
    expect(unansweredRowMessage("network", "absent")).toMatch(/not added/);
    const unknown = unansweredRowMessage("timeout", "unknown");
    expect(unknown).not.toMatch(/not added/);
    expect(unknown).toMatch(/could not check whether it was saved/);
  });

  it("keeps the server's own words for a server error", () => {
    expect(unansweredRowMessage("server", "absent", { serverMessage: "Failed to create post" })).toBe("Failed to create post");
    expect(unansweredRowMessage("server", "unknown", { serverMessage: "Failed to create post" })).toMatch(
      /^Failed to create post, and we could not check/,
    );
  });
});

describe("the end summary", () => {
  it("counts late saves as added, and groups the reasons", () => {
    const summary = summariseAddRun([
      { kind: "added" },
      { kind: "added" },
      { kind: "late" },
      { kind: "already" },
      { kind: "already" },
      { kind: "repeat" },
      { kind: "failed", reason: "Not a post link we recognise." },
      { kind: "failed", reason: "Not a post link we recognise." },
      { kind: "failed", reason: "Rejected (400)" },
    ]);
    expect(summary).toMatchObject({ added: 3, already: 2, repeats: 1, failedTotal: 3 });
    expect(addRunSummaryText(summary)).toBe("3 added · 2 already here · 1 pasted twice · 3 not added");
    expect(addRunReasonsText(summary)).toBe("Not a post link we recognise. (2)\nRejected (400)");
  });

  it("leaves out empty parts", () => {
    expect(addRunSummaryText(summariseAddRun([{ kind: "added" }]))).toBe("1 added");
    expect(addRunReasonsText(summariseAddRun([{ kind: "added" }]))).toBe("");
  });
});

describe("addProgressText", () => {
  it("counts what has finished, since several links are in flight at once", () => {
    expect(addProgressText({ done: 14, total: 37, checking: false })).toBe("Adding 37 posts… 14 done");
  });

  it("says when it is checking, and reads naturally for one link", () => {
    expect(addProgressText({ done: 2, total: 5, checking: true })).toBe(
      "Adding 5 posts… 2 done · no answer yet, checking whether it was saved",
    );
    expect(addProgressText({ done: 0, total: 1, checking: false })).toBe("Adding 1 post…");
  });
});

/* Walkthrough 2026-10-13 A1#4: three links on three platforms took 22.7s on
   the demo DB because each waited for the one before it. The pacer and rate
   limits the one-at-a-time rule protects are per platform. */
describe("platformLanes", () => {
  it("splits by platform and keeps each lane in submit order", () => {
    const items = ["tt1", "ig1", "tt2", "yt1", "ig2", "x"];
    const platform = (s: string) => (s === "x" ? null : s.slice(0, 2));
    expect(platformLanes(items, platform)).toEqual([["tt1", "tt2"], ["ig1", "ig2"], ["yt1"], ["x"]]);
  });
});

describe("runInLanes", () => {
  const instantSleep = jest.fn(async () => {});

  it("runs different lanes at the same time and one lane one at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    const perLane = new Map<string, number>();
    let lanePeak = 0;
    const log: string[] = [];
    await runInLanes(
      [["tt1", "tt2", "tt3"], ["ig1", "ig2"], ["yt1"]],
      async (item) => {
        const lane = item.slice(0, 2);
        inFlight += 1;
        perLane.set(lane, (perLane.get(lane) ?? 0) + 1);
        peak = Math.max(peak, inFlight);
        lanePeak = Math.max(lanePeak, perLane.get(lane)!);
        await new Promise((r) => setTimeout(r, 5));
        log.push(item);
        inFlight -= 1;
        perLane.set(lane, perLane.get(lane)! - 1);
      },
      { sleep: instantSleep },
    );
    expect(peak).toBe(3);
    expect(lanePeak).toBe(1);
    expect(log.filter((x) => x.startsWith("tt"))).toEqual(["tt1", "tt2", "tt3"]);
    expect(log).toHaveLength(6);
  });

  it("never runs more lanes than the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await runInLanes(
      [["a"], ["b"], ["c"], ["d"], ["e"]],
      async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
      },
      { sleep: instantSleep, limit: 2 },
    );
    expect(ADD_PLATFORM_LANES).toBe(3);
    expect(peak).toBe(2);
  });

  it("keeps the group pause inside a lane", async () => {
    const sleep = jest.fn(async () => {});
    const lane = Array.from({ length: 25 }, (_, i) => i);
    await runInLanes([lane], async () => {}, { sleep, groupSize: 10, groupPauseMs: 2_000 });
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });
});
