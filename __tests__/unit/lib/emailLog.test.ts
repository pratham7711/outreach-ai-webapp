/**
 * @jest-environment node
 */

/**
 * Every outbound message leaves a record.
 *
 * The guarantee is not "invites are logged" but "mail is logged", and it holds
 * because the record is written inside sendEmail rather than at each call site.
 * These tests pin that placement: the three outcomes a send can have, the
 * promise that recording never changes what the caller is told, and the fact
 * that a message which never reached the provider is still on the record --
 * that last one is the whole reason the table exists, since a send that did
 * not happen is exactly the one nobody can otherwise account for.
 */

jest.mock("@/lib/db", () => ({
  db: { emailLog: { create: jest.fn() } },
}));

import { sendEmail } from "@/lib/email";
import { db } from "@/lib/db";

const mockCreate = (db as any).emailLog.create as jest.Mock;

const OK = {
  ok: true,
  json: async () => ({ id: "re_abc123" }),
  text: async () => "",
} as unknown as Response;

function refused(status: number, body: string) {
  return { ok: false, status, text: async () => body, json: async () => ({}) } as unknown as Response;
}

/** The row that was written, unwrapped from Prisma's { data } envelope. */
function loggedRow() {
  expect(mockCreate).toHaveBeenCalledTimes(1);
  return mockCreate.mock.calls[0][0].data;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreate.mockResolvedValue({ id: "log-1" });
  process.env.RESEND_API_KEY = "test-key";
  global.fetch = jest.fn().mockResolvedValue(OK) as any;
});

afterEach(() => {
  delete process.env.RESEND_API_KEY;
});

describe("sendEmail records every attempt", () => {
  it("logs a delivered message with the provider's id", async () => {
    const res = await sendEmail({
      to: "sanskar@example.test",
      subject: "You have been invited",
      text: "body",
      kind: "invite",
      orgId: "org-1",
      actorEmail: "owner@acme.test",
      entityId: "inv-1",
    });

    expect(res).toEqual({ sent: true, id: "re_abc123" });
    expect(loggedRow()).toMatchObject({
      orgId: "org-1",
      kind: "invite",
      recipients: ["sanskar@example.test"],
      subject: "You have been invited",
      status: "sent",
      providerId: "re_abc123",
      actorEmail: "owner@acme.test",
      entityId: "inv-1",
      error: null,
    });
  });

  it("logs a refusal with the status and body, not just 'failed'", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(refused(422, "domain not verified"));

    const res = await sendEmail({ to: "x@example.test", subject: "s", text: "b", kind: "invite_resend" });

    expect(res).toEqual({ sent: false, reason: "failed" });
    const row = loggedRow();
    expect(row.status).toBe("failed");
    expect(row.kind).toBe("invite_resend");
    /* The provider's own words. "failed" alone sends somebody to the Resend
       dashboard to find out what everyone already knew at the time. */
    expect(row.error).toContain("422");
    expect(row.error).toContain("domain not verified");
  });

  it("logs the send that never happened because no provider is configured", async () => {
    delete process.env.RESEND_API_KEY;

    const res = await sendEmail({ to: "x@example.test", subject: "s", text: "b", kind: "password_reset" });

    expect(res).toEqual({ sent: false, reason: "not-configured" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(loggedRow()).toMatchObject({ status: "not_configured", kind: "password_reset" });
  });

  it("logs a thrown send, including a provider that timed out", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("The operation was aborted"));

    const res = await sendEmail({ to: "x@example.test", subject: "s", text: "b" });

    expect(res).toEqual({ sent: false, reason: "failed" });
    const row = loggedRow();
    expect(row.status).toBe("failed");
    expect(row.error).toContain("aborted");
    /* No kind given: it still lands under a real slug rather than null, so the
       column can be grouped on without special-casing. */
    expect(row.kind).toBe("unknown");
  });

  it("keeps one row for a fan-out to many addresses", async () => {
    await sendEmail({
      to: ["a@example.test", "b@example.test", "c@example.test"],
      subject: "Campaign updated",
      text: "body",
      kind: "notification",
      orgId: "org-1",
    });

    /* One message to three people is one thing that happened. Three rows would
       overstate the volume and make a fan-out look like a loop. */
    expect(loggedRow().recipients).toEqual(["a@example.test", "b@example.test", "c@example.test"]);
  });

  it("files platform mail under no org rather than inventing one", async () => {
    await sendEmail({ to: "ops@example.test", subject: "[CRITICAL] cron", text: "b", kind: "ops_alert" });

    expect(loggedRow().orgId).toBeNull();
  });

  it("does not turn a delivered email into a failure when the log write dies", async () => {
    mockCreate.mockRejectedValue(new Error("connection terminated"));

    /* The mail is already gone by then. Reporting failure would send the caller
       looking for a message that is sitting in the recipient's inbox. */
    await expect(
      sendEmail({ to: "x@example.test", subject: "s", text: "b", kind: "invite" })
    ).resolves.toEqual({ sent: true, id: "re_abc123" });
  });

  it("truncates a huge provider error rather than refusing to record it", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(refused(500, "x".repeat(5000)));

    await sendEmail({ to: "x@example.test", subject: "s", text: "b" });

    expect(loggedRow().error.length).toBeLessThanOrEqual(500);
  });
});
