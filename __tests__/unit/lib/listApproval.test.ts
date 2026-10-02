import {
  EMPTY_COUNTS,
  countDecisions,
  isDuplicableFromApproval,
  parseDecision,
  parseRateInput,
  rollupStatus,
  type ListItemDecision,
} from "@/lib/lists/approval";

const items = (...d: ListItemDecision[]) => d.map((decision) => ({ decision }));
const live = { archived: false, hasShareLink: true };

describe("countDecisions", () => {
  it("counts each verdict and the total", () => {
    expect(countDecisions(items("APPROVED", "REJECTED", "PENDING", "APPROVED"))).toEqual({ total: 4, approved: 2, rejected: 1, pending: 1 });
  });

  it("returns zeroes for an empty list", () => {
    expect(countDecisions([])).toEqual(EMPTY_COUNTS);
  });

  it("does not mutate the shared EMPTY_COUNTS seed", () => {
    countDecisions(items("APPROVED"));
    expect(EMPTY_COUNTS).toEqual({ total: 0, pending: 0, approved: 0, rejected: 0 });
  });
});

describe("parseDecision", () => {
  it("reads anything unrecognised as undecided", () => {
    expect(parseDecision("APPROVED")).toBe("APPROVED");
    expect(parseDecision("REJECTED")).toBe("REJECTED");
    expect(parseDecision("approved")).toBe("PENDING");
    expect(parseDecision(null)).toBe("PENDING");
  });
});

describe("rollupStatus", () => {
  it("is APPROVED once every creator is decided and at least one is a yes", () => {
    expect(rollupStatus(countDecisions(items("APPROVED", "REJECTED")), live)).toBe("APPROVED");
  });

  it("stays SHARED when the client said no to everybody", () => {
    expect(rollupStatus(countDecisions(items("REJECTED", "REJECTED")), live)).toBe("SHARED");
  });

  it("falls back out of APPROVED when a new creator is pending", () => {
    expect(rollupStatus(countDecisions(items("APPROVED", "PENDING")), live)).toBe("SHARED");
  });

  it("is DRAFT while there is no live share link", () => {
    expect(rollupStatus(countDecisions(items("PENDING")), { archived: false, hasShareLink: false })).toBe("DRAFT");
  });

  it("never calls an empty list approved", () => {
    expect(rollupStatus(EMPTY_COUNTS, live)).toBe("SHARED");
  });

  it("leaves an archived list archived whatever the decisions say", () => {
    expect(rollupStatus(countDecisions(items("APPROVED")), { archived: true, hasShareLink: true })).toBe("ARCHIVED");
  });
});

describe("isDuplicableFromApproval", () => {
  it("is true for an approved list", () => {
    expect(isDuplicableFromApproval("APPROVED", countDecisions(items("APPROVED")))).toBe(true);
  });

  it("is true mid-review as soon as one creator is approved", () => {
    expect(isDuplicableFromApproval("SHARED", countDecisions(items("APPROVED", "PENDING")))).toBe(true);
  });

  it("is false when nothing has been approved", () => {
    expect(isDuplicableFromApproval("SHARED", countDecisions(items("REJECTED", "PENDING")))).toBe(false);
  });
});

describe("parseRateInput", () => {
  it("accepts numbers and the strings a text cell produces", () => {
    expect(parseRateInput(1500)).toEqual({ ok: true, rate: 1500 });
    expect(parseRateInput("1,250.50")).toEqual({ ok: true, rate: 1250.5 });
    expect(parseRateInput("$900")).toEqual({ ok: true, rate: 900 });
  });

  it("clears on a blank cell rather than storing zero", () => {
    // A blanked cell means "not quoted", which is a different claim from "free".
    expect(parseRateInput("")).toEqual({ ok: true, rate: null });
    expect(parseRateInput(null)).toEqual({ ok: true, rate: null });
  });

  it("refuses a negative, non-numeric or absurd rate", () => {
    expect(parseRateInput(-5).ok).toBe(false);
    expect(parseRateInput("abc").ok).toBe(false);
    expect(parseRateInput(1e12).ok).toBe(false);
    expect(parseRateInput(Number.NaN).ok).toBe(false);
    expect(parseRateInput(true).ok).toBe(false);
  });
});
