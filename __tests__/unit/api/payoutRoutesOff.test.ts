/**
 * @jest-environment node
 *
 * Every payout route answers 404 while payouts are switched off
 * (lib/payouts/switch.ts), and does so before it reads a session or the
 * database -- so the answer is the same for a stranger, a VIEWER and an OWNER,
 * and is indistinguishable from a route that does not exist.
 *
 * Switched back on, the same handlers must reach their own session checks
 * again: the gate sits in front of the permission checks, it does not replace
 * them. The integration suites (payouts, payoutsDetail, campaignPayoutRequests,
 * portalPayoutRequests, ...) cover what they do after that.
 *
 * The list is also checked against the filesystem, so a new payout route that
 * forgets the gate fails here rather than shipping live.
 */
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";

/* State inside the factory, not a test-scope variable: modules these routes
   import (the notification catalog) read the switch while they load, which is
   before a test-scope variable would be initialised. */
jest.mock("@/lib/payouts/switch", () => {
  const state = { on: false };
  return {
    get PAYOUTS_ENABLED() {
      return state.on;
    },
    setForTest(on: boolean) {
      state.on = on;
    },
  };
});

/* Any touch of the database fails the test: the 404 must come first. */
const mockDbTouched: string[] = [];
jest.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get(_t, prop) {
        mockDbTouched.push(String(prop));
        throw new Error(`db.${String(prop)} touched`);
      },
    },
  ),
}));
jest.mock("@/lib/auth", () => ({ auth: jest.fn() }));
jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn(), getAuditActor: jest.fn() }));
jest.mock("@/lib/creator-auth", () => ({ getCreatorSession: jest.fn() }));

import { auth } from "@/lib/auth";
import { authenticateRequest } from "@/lib/authenticate";
import { getCreatorSession } from "@/lib/creator-auth";
import * as payoutSwitch from "@/lib/payouts/switch";

const setPayoutsOn = (on: boolean) => (payoutSwitch as unknown as { setForTest(on: boolean): void }).setForTest(on);

import * as payouts from "@/app/api/payouts/route";
import * as payoutById from "@/app/api/payouts/[id]/route";
import * as payoutsBulk from "@/app/api/payouts/bulk/route";
import * as payoutOptions from "@/app/api/payouts/options/route";
import * as payoutRequests from "@/app/api/payout-requests/route";
import * as recipients from "@/app/api/recipients/route";
import * as campaignPayoutRequests from "@/app/api/campaigns/[id]/payout-requests/route";
import * as campaignPayoutRequest from "@/app/api/campaigns/[id]/payout-requests/[requestId]/route";
import * as payoutCalculator from "@/app/api/campaigns/[id]/payout-calculator/route";
import * as viewLedger from "@/app/api/campaigns/[id]/view-ledger/route";
import * as portalEarnings from "@/app/api/portal/earnings/route";
import * as portalPayoutRequests from "@/app/api/portal/payout-requests/route";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

/* path relative to app/api -> module and the methods behind the switch */
const GATED: Array<[string, Record<string, unknown>, string[]]> = [
  ["payouts/route.ts", payouts, ["GET", "POST"]],
  ["payouts/[id]/route.ts", payoutById, ["PATCH"]],
  ["payouts/bulk/route.ts", payoutsBulk, ["POST"]],
  ["payouts/options/route.ts", payoutOptions, ["GET"]],
  ["payout-requests/route.ts", payoutRequests, ["GET"]],
  ["recipients/route.ts", recipients, ["GET"]],
  ["campaigns/[id]/payout-requests/route.ts", campaignPayoutRequests, ["GET", "POST"]],
  ["campaigns/[id]/payout-requests/[requestId]/route.ts", campaignPayoutRequest, ["PATCH"]],
  ["campaigns/[id]/payout-calculator/route.ts", payoutCalculator, ["GET"]],
  ["campaigns/[id]/view-ledger/route.ts", viewLedger, ["GET"]],
  ["portal/earnings/route.ts", portalEarnings, ["GET"]],
  ["portal/payout-requests/route.ts", portalPayoutRequests, ["GET", "POST"]],
];

/* Handlers in those files that are deliberately NOT behind the switch. */
const UNGATED: Record<string, string> = {
  "campaigns/[id]/view-ledger/route.ts POST":
    "the CPM accrual; switching payouts off hides earnings but never changes what gets written",
};

const CASES = GATED.flatMap(([file, mod, methods]) =>
  methods.map((method) => [`${method} ${file}`, method, mod[method] as Handler] as const),
);

const PARAMS = { id: "camp-x", requestId: "req-x" };
function call(method: string, handler: Handler) {
  const req = new NextRequest(`http://localhost/api/x`, {
    method,
    ...(method === "GET" ? {} : { body: JSON.stringify({}), headers: { "content-type": "application/json" } }),
  });
  return handler(req, { params: Promise.resolve(PARAMS) });
}

const sessionReaders = [auth, authenticateRequest, getCreatorSession] as unknown as jest.Mock[];
const sessionReads = () => sessionReaders.reduce((n, fn) => n + fn.mock.calls.length, 0);

beforeEach(() => {
  jest.clearAllMocks();
  mockDbTouched.length = 0;
  for (const fn of sessionReaders) fn.mockResolvedValue(null);
});

describe("payout routes with payouts switched off", () => {
  beforeEach(() => {
    setPayoutsOn(false);
  });

  it.each(CASES)("%s answers 404 without reading a session or the database", async (_name, method, handler) => {
    expect(typeof handler).toBe("function");
    /* A signed-in OWNER gets the same 404 as a stranger. */
    (auth as unknown as jest.Mock).mockResolvedValue({ user: { id: "u-1", orgId: "org-1", role: "OWNER" } });
    (authenticateRequest as jest.Mock).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "OWNER" });
    (getCreatorSession as jest.Mock).mockResolvedValue({ creatorUserId: "cu-1", handle: "fake_creator" });

    const res = await call(method, handler);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
    expect(sessionReads()).toBe(0);
    expect(mockDbTouched).toEqual([]);
  });
});

describe("payout routes with payouts switched back on", () => {
  beforeEach(() => {
    setPayoutsOn(true);
  });

  it.each(CASES)("%s goes back to its own session check", async (_name, method, handler) => {
    const res = await call(method, handler);
    expect(res.status).not.toBe(404);
    expect(sessionReads()).toBeGreaterThan(0);
    /* No session was given, so none of them may reach data. */
    expect([401, 403]).toContain(res.status);
    expect(mockDbTouched).toEqual([]);
  });
});

describe("the gated list is complete", () => {
  const API_ROOT = path.join(process.cwd(), "app", "api");
  const routeFiles = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) routeFiles(full, out);
      else if (e.name === "route.ts") out.push(path.relative(API_ROOT, full).split(path.sep).join("/"));
    }
    return out;
  };
  const PAYOUT_PATH = /payout|recipients|portal\/earnings|view-ledger/;

  it("covers every route file whose path is about payouts", () => {
    const onDisk = routeFiles(API_ROOT).filter((f) => PAYOUT_PATH.test(f)).sort();
    expect(GATED.map(([f]) => f).sort()).toEqual(onDisk);
  });

  it("gates every exported handler in those files, bar the listed exceptions", () => {
    for (const [file, mod] of GATED) {
      const src = fs.readFileSync(path.join(API_ROOT, file), "utf8");
      const exported = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((m) => typeof mod[m] === "function");
      for (const method of exported) {
        const gated = GATED.find(([f]) => f === file)![2].includes(method);
        if (!gated) {
          expect(UNGATED[`${file} ${method}`]).toBeDefined();
          continue;
        }
        const start = src.search(new RegExp(`export\\s+async\\s+function\\s+${method}\\b`));
        const body = src.slice(start, start + 600);
        expect(body).toMatch(/payoutsOffResponse\(\)/);
      }
    }
  });
});
