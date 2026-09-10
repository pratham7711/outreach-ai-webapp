import { CAMPAIGN_START_STATUS, defaultStatusDefFor } from "@/lib/campaigns/statusDefaults";

/* The eight statuses both prod orgs actually carry, in their real sort order.
   The awkward one is CANCELLED: "Paused" sorts before "Canceled", so picking
   the first def in the bucket would file every cancelled campaign as paused. */
const DEFS = [
  { id: "pending", name: "Pending", bucket: "PENDING", sortOrder: 0 },
  { id: "active", name: "In-Progress", bucket: "IN_PROGRESS", sortOrder: 1 },
  { id: "invoice", name: "Need To Invoice", bucket: "IN_PROGRESS", sortOrder: 2 },
  { id: "invoiced", name: "Invoiced", bucket: "IN_PROGRESS", sortOrder: 3 },
  { id: "paid", name: "Paid", bucket: "IN_PROGRESS", sortOrder: 4 },
  { id: "complete", name: "Complete", bucket: "COMPLETE", sortOrder: 5 },
  { id: "paused", name: "Paused", bucket: "CANCELLED", sortOrder: 6 },
  { id: "canceled", name: "Canceled", bucket: "CANCELLED", sortOrder: 7 },
];

describe("CAMPAIGN_START_STATUS", () => {
  // DRAFT has no tab on the campaigns page and no org status def points at it,
  // so a campaign created there is both unreachable and unnamed.
  it("is the bucket the Active tab counts, not DRAFT", () => {
    expect(CAMPAIGN_START_STATUS).toBe("IN_PROGRESS");
  });
});

describe("defaultStatusDefFor", () => {
  it("resolves each bucket to the status that means the same thing", () => {
    expect(defaultStatusDefFor("PENDING", DEFS)?.id).toBe("pending");
    expect(defaultStatusDefFor("IN_PROGRESS", DEFS)?.id).toBe("active");
    expect(defaultStatusDefFor("COMPLETE", DEFS)?.id).toBe("complete");
  });

  it("prefers Canceled over the lower-sorted Paused under CANCELLED", () => {
    expect(defaultStatusDefFor("CANCELLED", DEFS)?.id).toBe("canceled");
  });

  it("matches the name regardless of case, spacing or punctuation", () => {
    const defs = [{ id: "x", name: "in progress", bucket: "IN_PROGRESS", sortOrder: 9 }];
    expect(defaultStatusDefFor("IN_PROGRESS", defs)?.id).toBe("x");
  });

  it("accepts Active as the org's word for IN_PROGRESS", () => {
    const defs = [
      { id: "later", name: "Active", bucket: "IN_PROGRESS", sortOrder: 4 },
      { id: "first", name: "Kickoff", bucket: "IN_PROGRESS", sortOrder: 1 },
    ];
    expect(defaultStatusDefFor("IN_PROGRESS", defs)?.id).toBe("later");
  });

  it("falls back to the lowest sortOrder when no name matches the bucket", () => {
    const defs = [
      { id: "b", name: "Wrapping Up", bucket: "COMPLETE", sortOrder: 3 },
      { id: "a", name: "Signed Off", bucket: "COMPLETE", sortOrder: 1 },
    ];
    expect(defaultStatusDefFor("COMPLETE", defs)?.id).toBe("a");
  });

  it("ignores defs belonging to another bucket", () => {
    expect(defaultStatusDefFor("PENDING", [DEFS[1], DEFS[5]])).toBeNull();
  });

  // The one case a campaign legitimately carries no named status: an org that
  // has defined none. The caller writes null and the row still saves.
  it("returns null when the org has defined nothing for that bucket", () => {
    expect(defaultStatusDefFor("DRAFT", DEFS)).toBeNull();
    expect(defaultStatusDefFor("IN_PROGRESS", [])).toBeNull();
  });
});
