/**
 * @jest-environment node
 *
 * Each ops alert goes out at most once a day. The post sync runs every six
 * hours, so a problem that outlived one run used to mail four times a day, and
 * every mail had a different subject because the title carries the run's counts.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
const sendEmail = jest.fn<Promise<undefined>, [{ kind: string; subject: string }]>(async () => undefined);
jest.mock("@/lib/email", () => ({
  sendEmail: (message: { kind: string; subject: string }) => sendEmail(message),
}));
const findMany = jest.fn(async (): Promise<{ subject: string }[]> => []);
jest.mock("@/lib/db", () => ({ db: { emailLog: { findMany: (...args: unknown[]) => findMany(...(args as [])) } } }));

import { alertKey, alertOps, alertSentWithin } from "@/lib/alerts";

const realTo = process.env.ALERT_EMAIL_TO;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.ALERT_EMAIL_TO = "ops@example.com";
});
afterAll(() => {
  process.env.ALERT_EMAIL_TO = realTo;
});

describe("alertKey", () => {
  it("masks the counts, so two runs of one problem are one alert", () => {
    expect(alertKey("[CRITICAL] Post metric sync returning nothing: 90/170 attempts")).toBe(
      alertKey("[CRITICAL] Post metric sync returning nothing: 15/182 attempts"),
    );
    expect(alertKey("[WARN] 6 post(s) stopped")).not.toBe(alertKey("[CRITICAL] 6 post(s) stopped"));
  });
});

describe("alertOps once a day", () => {
  it("sends an alert the first time", async () => {
    await alertOps({ source: "cron/sync-posts", title: "Post metric sync returning nothing: 90/170 attempts", severity: "critical" });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      kind: "ops_alert",
      subject: "[CRITICAL] Post metric sync returning nothing: 90/170 attempts",
    });
  });

  it("holds the same alert back for a day, whatever its counts say", async () => {
    findMany.mockResolvedValueOnce([{ subject: "[CRITICAL] Post metric sync returning nothing: 90/170 attempts" }]);

    await alertOps({ source: "cron/sync-posts", title: "Post metric sync returning nothing: 15/182 attempts", severity: "critical" });

    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("still sends a different alert", async () => {
    findMany.mockResolvedValueOnce([{ subject: "[CRITICAL] Post metric sync returning nothing: 90/170 attempts" }]);

    await alertOps({ source: "cron/sync-posts", title: "Post metric sync crashed", severity: "critical" });

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it("asks for the last day of ops alerts that did not fail to send", async () => {
    const before = Date.now();
    await alertSentWithin("[WARN] x");
    const where = (findMany.mock.calls[0] as unknown as [{ where: { kind: string; status: unknown; createdAt: { gte: Date } } }])[0].where;

    expect(where.kind).toBe("ops_alert");
    expect(where.status).toEqual({ not: "failed" });
    expect(before - where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 5);
  });

  it("sends anyway when it cannot read its own history", async () => {
    findMany.mockRejectedValueOnce(new Error("db down"));

    await alertOps({ source: "cron/sync-posts", title: "Post metric sync crashed", severity: "critical" });

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});
