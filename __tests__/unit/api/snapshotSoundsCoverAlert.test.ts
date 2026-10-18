/**
 * @jest-environment node
 *
 * The daily sound cron reports sounds whose cover was never kept
 * (app/api/cron/snapshot-sounds, lib/sounds/coverStore#soundsWithoutCover):
 * a copy is never lost once held, so this is the one way a client report can
 * still show a music note, and it should reach ops before a client sees it.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/sounds/snapshot", () => ({
  snapshotSounds: jest.fn().mockResolvedValue({ snapshots: 3, failed: 0, skipped: 0 }),
}));
const mockMissing = jest.fn();
jest.mock("@/lib/sounds/coverStore", () => ({ soundsWithoutCover: () => mockMissing() }));
jest.mock("@/lib/alerts", () => ({
  ...jest.requireActual("@/lib/alerts"),
  alertOps: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/ops/cronRoute", () => ({ cronRoute: (_job: string, handler: unknown) => handler }));

import { alertOps } from "@/lib/alerts";
import { GET } from "@/app/api/cron/snapshot-sounds/route";

const mockAlert = alertOps as unknown as jest.Mock;
const run = (q = "") =>
  GET(new NextRequest(`https://x/api/cron/snapshot-sounds${q}`, { headers: { authorization: "Bearer secret" } }));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.CRON_SECRET = "secret";
});

it("names the sounds still without a cover", async () => {
  mockMissing.mockResolvedValue(["s-1", "s-2"]);
  expect((await run()).status).toBe(200);
  expect(mockAlert).toHaveBeenCalledTimes(1);
  expect(mockAlert.mock.calls[0][0]).toMatchObject({
    source: "cron/snapshot-sounds",
    title: "Sound covers missing: 2",
    severity: "warn",
    facts: { sounds: 2, soundIds: "s-1, s-2" },
  });
});

it("stays quiet when every sound has its cover, and on a dry run", async () => {
  mockMissing.mockResolvedValue([]);
  await run();
  mockMissing.mockResolvedValue(["s-1"]);
  await run("?dryRun=1");
  expect(mockAlert).not.toHaveBeenCalled();
});

it("never fails the cron over the check", async () => {
  mockMissing.mockRejectedValue(new Error("Can't reach database server"));
  expect((await run()).status).toBe(200);
  expect(mockAlert).not.toHaveBeenCalled();
});
