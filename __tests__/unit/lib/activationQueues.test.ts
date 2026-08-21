import {
  ACTIVATION_QUEUES,
  ACTIVATION_STAGE_COUNTERS,
  queueForStatus,
  groupByQueue,
  countByStatuses,
} from "@/lib/activationQueues";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read from schema.prisma as text rather than importing the generated client,
 * which pulls the Prisma runtime into this jsdom suite and fails on TextEncoder.
 * Reading the schema is the stronger guard anyway: it fails when someone adds an
 * ActivationStatus, which is exactly the change that would silently drop rows
 * off the page.
 */
function schemaActivationStatuses(): string[] {
  const schema = readFileSync(join(process.cwd(), "prisma", "schema.prisma"), "utf8");
  const block = schema.match(/enum ActivationStatus \{([^}]*)\}/);
  if (!block) throw new Error("enum ActivationStatus not found in schema.prisma");
  return block[1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim())
    .filter((l) => /^[A-Z_]+$/.test(l));
}

const ALL_STATUSES = schemaActivationStatuses();

describe("activation queues", () => {
  it("covers every ActivationStatus in the schema exactly once", () => {
    // The guard that matters: a new status added to the enum must not silently
    // vanish from the page, and no status may sit in two queues at once.
    const placed = ACTIVATION_QUEUES.flatMap((q) => [...q.statuses]);
    expect([...placed].sort()).toEqual([...ALL_STATUSES].sort());
    expect(new Set(placed).size).toBe(placed.length);
  });

  it("returns null for an unknown status rather than defaulting it into a queue", () => {
    expect(queueForStatus("SOMETHING_NEW")).toBeNull();
    expect(queueForStatus("AWAITING_DRAFT")).toBe("pending");
  });

  it("groups rows into queues and keeps unclaimed statuses separate", () => {
    const rows = [
      { id: "a", status: "AWAITING_DRAFT" },
      { id: "b", status: "AWAITING_APPROVAL" },
      { id: "c", status: "DRAFT_SUBMITTED" },
      { id: "d", status: "COMPLETE" },
      { id: "e", status: "NOT_A_STATUS" },
    ];

    const { groups, ungrouped } = groupByQueue(rows);
    expect(groups.get("pending")!.map((r) => r.id)).toEqual(["a"]);
    // Two statuses share the review queue, and input order is preserved.
    expect(groups.get("review")!.map((r) => r.id)).toEqual(["b", "c"]);
    expect(groups.get("complete")!.map((r) => r.id)).toEqual(["d"]);
    expect(groups.get("progress")!).toEqual([]);
    expect(ungrouped.map((r) => r.id)).toEqual(["e"]);
  });

  it("gives every queue a key for every queue, even when empty", () => {
    const { groups } = groupByQueue([]);
    for (const q of ACTIVATION_QUEUES) expect(groups.get(q.key)).toEqual([]);
  });

  it("counts the four stage counters off the same rows", () => {
    const rows = [
      { status: "AWAITING_DRAFT" },
      { status: "AWAITING_DRAFT" },
      { status: "DRAFT_SUBMITTED" },
      { status: "AWAITING_APPROVAL" },
      { status: "DECLINED" },
      { status: "APPROVED" },
      { status: "POSTED" },
    ];
    const counts = ACTIVATION_STAGE_COUNTERS.map((c) => countByStatuses(rows, c.statuses));
    // Awaiting Draft 2 · Awaiting Approval 2 (submitted + awaiting) · Revision 1 · Posting 1
    expect(counts).toEqual([2, 2, 1, 1]);
    // POSTED is deliberately in none of the four: it is in progress, not waiting.
    expect(counts.reduce((a, b) => a + b, 0)).toBe(rows.length - 1);
  });

  it("does not put Complete in any stage counter", () => {
    const counts = ACTIVATION_STAGE_COUNTERS.map((c) =>
      countByStatuses([{ status: "COMPLETE" }], c.statuses)
    );
    expect(counts).toEqual([0, 0, 0, 0]);
  });
});
