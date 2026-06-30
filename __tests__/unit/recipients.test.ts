import { buildRecipients, summarizeRecipients, type RecipientPayout } from "@/lib/recipients/aggregate";

function payout(over: Partial<RecipientPayout> = {}): RecipientPayout {
  return {
    creatorId: "c1",
    creatorName: "Alice",
    creatorHandle: "alice",
    creatorPlatform: "TIKTOK",
    amount: 100,
    status: "SUCCESS",
    paymentMethod: "PAYPAL",
    recipientPaypalEmail: "alice@pay.me",
    completedAt: "2026-01-02T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("buildRecipients", () => {
  it("returns an empty array for empty or invalid input", () => {
    expect(buildRecipients([])).toEqual([]);
    expect(buildRecipients(null as unknown as RecipientPayout[])).toEqual([]);
  });

  it("groups payouts by creator and splits totals by status", () => {
    const recipients = buildRecipients([
      payout({ amount: 100, status: "SUCCESS" }),
      payout({ amount: 50, status: "PENDING" }),
      payout({ amount: 25, status: "PROCESSING" }),
      payout({ amount: 10, status: "FAILED" }),
    ]);
    expect(recipients).toHaveLength(1);
    const r = recipients[0];
    expect(r.totalPaid).toBe(100);
    expect(r.pending).toBe(75);
    expect(r.failed).toBe(10);
    expect(r.payoutCount).toBe(4);
  });

  it("matches status case-insensitively", () => {
    const r = buildRecipients([payout({ status: "success" }), payout({ status: "pending", amount: 40 })])[0];
    expect(r.totalPaid).toBe(100);
    expect(r.pending).toBe(40);
  });

  it("treats non-finite or negative amounts as zero", () => {
    const r = buildRecipients([
      payout({ amount: Number.NaN, status: "SUCCESS" }),
      payout({ amount: -500, status: "SUCCESS" }),
      payout({ amount: Infinity, status: "SUCCESS" }),
    ])[0];
    expect(r.totalPaid).toBe(0);
    expect(r.payoutCount).toBe(3);
  });

  it("collects distinct payment methods sorted", () => {
    const r = buildRecipients([
      payout({ paymentMethod: "PAYPAL" }),
      payout({ paymentMethod: "BANK_TRANSFER" }),
      payout({ paymentMethod: "PAYPAL" }),
      payout({ paymentMethod: "" }),
    ])[0];
    expect(r.paymentMethods).toEqual(["BANK_TRANSFER", "PAYPAL"]);
  });

  it("keeps the most recent non-null paypal email", () => {
    const r = buildRecipients([
      payout({ recipientPaypalEmail: "old@pay.me", createdAt: "2026-01-01T00:00:00.000Z" }),
      payout({ recipientPaypalEmail: "new@pay.me", createdAt: "2026-03-01T00:00:00.000Z" }),
      payout({ recipientPaypalEmail: null, createdAt: "2026-04-01T00:00:00.000Z" }),
    ])[0];
    expect(r.paypalEmail).toBe("new@pay.me");
  });

  it("breaks equal-timestamp paypal email ties deterministically regardless of input order", () => {
    const ts = "2026-03-01T00:00:00.000Z";
    const forward = buildRecipients([
      payout({ recipientPaypalEmail: "b@pay.me", createdAt: ts, completedAt: null }),
      payout({ recipientPaypalEmail: "a@pay.me", createdAt: ts, completedAt: null }),
    ])[0];
    const reverse = buildRecipients([
      payout({ recipientPaypalEmail: "a@pay.me", createdAt: ts, completedAt: null }),
      payout({ recipientPaypalEmail: "b@pay.me", createdAt: ts, completedAt: null }),
    ])[0];
    expect(forward.paypalEmail).toBe("a@pay.me");
    expect(reverse.paypalEmail).toBe("a@pay.me");
  });

  it("tracks the latest payout date, preferring completedAt then createdAt", () => {
    const r = buildRecipients([
      payout({ completedAt: "2026-02-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" }),
      payout({ completedAt: null, createdAt: "2026-05-01T00:00:00.000Z" }),
    ])[0];
    expect(r.lastPayoutAt).toBe("2026-05-01T00:00:00.000Z");
  });

  it("sorts recipients by total paid descending, then by name", () => {
    const recipients = buildRecipients([
      payout({ creatorId: "c1", creatorName: "Alice", amount: 100, status: "SUCCESS" }),
      payout({ creatorId: "c2", creatorName: "Bob", amount: 300, status: "SUCCESS" }),
      payout({ creatorId: "c3", creatorName: "Cara", amount: 300, status: "SUCCESS" }),
    ]);
    expect(recipients.map((r) => r.creatorId)).toEqual(["c2", "c3", "c1"]);
  });

  it("falls back to a placeholder name when the creator name is missing", () => {
    const r = buildRecipients([payout({ creatorName: "" })])[0];
    expect(r.name).toBe("Unknown recipient");
  });

  it("skips rows without a creator id", () => {
    const recipients = buildRecipients([
      payout({ creatorId: "" }),
      payout({ creatorId: undefined as unknown as string }),
      payout({ creatorId: "c9" }),
    ]);
    expect(recipients).toHaveLength(1);
    expect(recipients[0].creatorId).toBe("c9");
  });
});

describe("summarizeRecipients", () => {
  it("returns zeroed stats for empty or invalid input", () => {
    expect(summarizeRecipients([])).toEqual({ recipientCount: 0, totalPaid: 0, totalPending: 0, totalFailed: 0 });
    expect(summarizeRecipients(null as never)).toEqual({ recipientCount: 0, totalPaid: 0, totalPending: 0, totalFailed: 0 });
  });

  it("sums totals across all recipients", () => {
    const recipients = buildRecipients([
      payout({ creatorId: "c1", amount: 100, status: "SUCCESS" }),
      payout({ creatorId: "c1", amount: 20, status: "PENDING" }),
      payout({ creatorId: "c2", amount: 50, status: "SUCCESS" }),
      payout({ creatorId: "c2", amount: 5, status: "FAILED" }),
    ]);
    const stats = summarizeRecipients(recipients);
    expect(stats.recipientCount).toBe(2);
    expect(stats.totalPaid).toBe(150);
    expect(stats.totalPending).toBe(20);
    expect(stats.totalFailed).toBe(5);
  });
});
