/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET as autoApprove } from "@/app/api/cron/auto-approve-submissions/route";

jest.mock("@/lib/db", () => ({
  db: {
    post: { findMany: jest.fn(), update: jest.fn() },
    campaign: { update: jest.fn() },
    viewFraudFlag: { findFirst: jest.fn() },
  },
}));

jest.mock("@/lib/audit", () => ({ logAudit: jest.fn().mockResolvedValue(undefined) }));

jest.mock("@/lib/marketplace/cap", () => ({
  computeCampaignAccrual: jest.fn().mockResolvedValue({
    accruedMinor: 0,
    capMinor: null,
    capReached: false,
  }),
}));

import { db } from "@/lib/db";

const mockDb = db as any;

const HOUR_MS = 60 * 60 * 1000;
const PAGE_SIZE = 200; // must track the route's own page size

type Row = {
  id: string;
  createdAt: Date;
  status: string;
  fraudOpen: boolean;
  campaign: {
    id: string;
    orgId: string;
    title: string;
    status: string;
    autoApproveHours: number | null;
    submissionDeadline: Date | null;
    marketplaceVisibility: string;
    ratePerThousand: number | null;
    marketplaceBudgetCapMinor: number | null;
    deletedAt: Date | null;
  };
};

function makeRow(
  i: number,
  over: Omit<Partial<Row>, "campaign"> & { campaign?: Partial<Row["campaign"]> } = {},
): Row {
  const { campaign, ...rest } = over;
  return {
    id: `post-${String(i).padStart(4, "0")}`,
    // Oldest first, so index order is createdAt order.
    createdAt: new Date(Date.now() - (10_000 - i) * HOUR_MS),
    status: "PENDING_REVIEW",
    fraudOpen: false,
    ...rest,
    campaign: {
      id: `camp-${i}`,
      orgId: "org-1",
      title: `Campaign ${i}`,
      status: "IN_PROGRESS",
      autoApproveHours: 48,
      submissionDeadline: null,
      marketplaceVisibility: "PUBLIC",
      ratePerThousand: null,
      marketplaceBudgetCapMinor: null,
      deletedAt: null,
      ...campaign,
    },
  };
}

/**
 * A stand-in for Postgres that honours exactly the predicates this route relies
 * on: the gates it pushed into SQL, and the keyset it pages with. A mock that
 * ignored the where clause would return the gated head to the loop and the
 * starvation test would pass for the wrong reason.
 */
function installStore(rows: Row[]) {
  mockDb.post.findMany.mockImplementation(async (args: any) => {
    const base = args.where.AND ? args.where.AND[0] : args.where;
    const keyset = args.where.AND ? args.where.AND[1] : null;
    const deadlineGte = base.campaign.OR[1].submissionDeadline.gte as Date;

    let out = rows.filter((r) => {
      if (r.status !== base.status) return false;
      if (r.fraudOpen) return false;
      const c = r.campaign;
      if (c.deletedAt) return false;
      if (c.marketplaceVisibility === base.campaign.marketplaceVisibility.not) return false;
      if (base.campaign.status.notIn.includes(c.status)) return false;
      if (c.submissionDeadline && c.submissionDeadline.getTime() < deadlineGte.getTime()) return false;
      return true;
    });

    if (keyset) {
      const [after, tie] = keyset.OR;
      out = out.filter(
        (r) =>
          r.createdAt.getTime() > after.createdAt.gt.getTime() ||
          (r.createdAt.getTime() === tie.createdAt.getTime() && r.id > tie.id.gt),
      );
    }

    out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1));
    return out.slice(0, args.take).map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      campaignId: r.campaign.id,
      campaign: { ...r.campaign },
    }));
  });

  mockDb.post.update.mockImplementation(async ({ where, data }: any) => {
    const row = rows.find((r) => r.id === where.id);
    if (row) row.status = data.status;
    return {};
  });
}

function cronReq(url = "http://localhost/api/cron/auto-approve-submissions") {
  return new NextRequest(url, { headers: { authorization: "Bearer secret" } });
}

const realSecret = process.env.CRON_SECRET;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = "secret";
  mockDb.campaign.update.mockResolvedValue({});
});

afterEach(() => {
  if (realSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = realSecret;
});

describe("auto-approve cron — a permanently gated head must not starve the queue", () => {
  /**
   * The bug this exists for: the route read the oldest 500 PENDING_REVIEW rows
   * and then applied the gates. A cancelled campaign, a passed deadline and an
   * unresolved fraud flag never clear and never change the post's status, so
   * gated rows pile up at the head of a createdAt-ordered read; once there are
   * 500 of them the window holds nothing else, and every eligible submission
   * behind them is skipped on every run, forever.
   */
  it("approves an eligible row sitting behind 500 permanently gated ones", async () => {
    const gated: Row[] = [];
    for (let i = 0; i < 500; i++) {
      const kind = i % 3;
      gated.push(
        makeRow(i, {
          fraudOpen: kind === 2,
          campaign: {
            status: kind === 0 ? "CANCELLED" : "IN_PROGRESS",
            submissionDeadline: kind === 1 ? new Date(Date.now() - 5 * 24 * HOUR_MS) : null,
          },
        }),
      );
    }
    const eligible = makeRow(9000, { id: "post-eligible" });
    installStore([...gated, eligible]);

    const res = await autoApprove(cronReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.approved).toBe(1);
    expect(body.timedOut).toBe(false);
    // The gated 500 are not candidates at all now, so they are not even read.
    expect(body.total).toBe(1);

    const updated = mockDb.post.update.mock.calls.map((c: any[]) => c[0].where.id);
    expect(updated).toEqual(["post-eligible"]);
  });

  it("pushes the permanent gates into the query rather than the loop", async () => {
    installStore([makeRow(1)]);
    await autoApprove(cronReq());

    const where = mockDb.post.findMany.mock.calls[0][0].where;
    expect(where.status).toBe("PENDING_REVIEW");
    expect(where.fraudFlags).toEqual({ none: { isResolved: false } });
    expect(where.campaign.status.notIn).toEqual(["COMPLETE", "CANCELLED"]);
    expect(where.campaign.OR[0]).toEqual({ submissionDeadline: null });
    expect(where.campaign.OR[1].submissionDeadline.gte).toBeInstanceOf(Date);
    // The per-post fraud lookup is gone with it.
    expect(mockDb.viewFraudFlag.findFirst).not.toHaveBeenCalled();
  });

  it("pages past the first window, and approving a row does not break the resume", async () => {
    const rows = Array.from({ length: PAGE_SIZE + 50 }, (_, i) => makeRow(i));
    installStore(rows);

    const res = await autoApprove(cronReq());
    const body = await res.json();

    expect(mockDb.post.findMany.mock.calls.length).toBeGreaterThan(1);
    expect(body.approved).toBe(PAGE_SIZE + 50);
    expect(body.timedOut).toBe(false);
    expect(rows.every((r) => r.status === "APPROVED")).toBe(true);
  });

  it("stops at the deadline and says so, instead of being cut off mid-page", async () => {
    installStore(Array.from({ length: 20 }, (_, i) => makeRow(i)));

    /* Real wall clock for the first few calls, then a jump past the four-minute
       budget -- the same shape as a run that spent its time on slow writes. */
    const realNow = Date.now.bind(Date);
    let calls = 0;
    jest.spyOn(Date, "now").mockImplementation(() => {
      calls++;
      return calls > 6 ? realNow() + 5 * 60 * 1000 : realNow();
    });

    try {
      const res = await autoApprove(cronReq());
      const body = await res.json();
      expect(body.timedOut).toBe(true);
      expect(body.approved).toBeLessThan(20);
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  it("skips a row that is not old enough yet, and keeps reading past it", async () => {
    const tooRecent = makeRow(1, { createdAt: new Date(Date.now() - HOUR_MS) });
    const ripe = makeRow(2, { id: "post-ripe" });
    installStore([tooRecent, ripe]);

    const res = await autoApprove(cronReq("http://localhost/api/cron/auto-approve-submissions?dryRun=1"));
    const body = await res.json();

    expect(body.summary.byReason).toEqual({ "too-recent": 1, "auto-approve": 1 });
    expect(body.wouldApprove).toBe(1);
  });
});
