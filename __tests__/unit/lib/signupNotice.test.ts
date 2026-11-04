/**
 * @jest-environment node
 *
 * The operator hears about every new workspace: one mail per signup to
 * ALERT_EMAIL_TO, nothing when no recipient is configured, and never an error
 * thrown back into the signup that triggered it.
 */
jest.mock("@/lib/observability/logger", () => ({
  createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));
type Sent = { kind: string; to: string[]; subject: string; text: string; orgId?: string; entityId?: string; replyTo?: string };
const sendEmail = jest.fn<Promise<unknown>, [Sent]>(async () => ({ sent: true, id: "re_1" }));
jest.mock("@/lib/email", () => ({ sendEmail: (m: Sent) => sendEmail(m) }));

import { notifyNewSignup, signupNoticeMessage, type SignupNoticeInput } from "@/lib/ops/signupNotice";

const input = (over: Partial<SignupNoticeInput> = {}): SignupNoticeInput => ({
  orgId: "org-new",
  userId: "user-new",
  orgName: "Harbour Media",
  orgType: "AGENCY",
  plan: "free",
  ownerName: "Asha Rao",
  ownerEmail: "asha@harbour.example",
  verificationSent: true,
  origin: "https://campaign.madeboring.com/",
  at: new Date("2026-11-04T18:11:00Z"),
  ...over,
});

const realTo = process.env.ALERT_EMAIL_TO;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.ALERT_EMAIL_TO = "ops@example.com, second@example.com";
});
afterAll(() => {
  process.env.ALERT_EMAIL_TO = realTo;
});

describe("signupNoticeMessage", () => {
  it("names the workspace, its type, owner, IST time and where to look", () => {
    const { subject, text } = signupNoticeMessage(input());
    expect(subject).toBe("New agency signup: Harbour Media");
    expect(text).toContain("Workspace:  Harbour Media");
    expect(text).toContain("Type:       Agency");
    expect(text).toContain("Plan:       free");
    expect(text).toContain("Owner:      Asha Rao <asha@harbour.example>");
    expect(text).toMatch(/Signed up:  4 Nov 2026,? 23:41 IST/);
    expect(text).toContain("Confirmation email to them: sent");
    expect(text).toContain("All workspaces: https://campaign.madeboring.com/platform");
    expect(text).toContain("org id:  org-new");
  });

  it("labels a brand as a brand and says when their confirmation did not go out", () => {
    const { subject, text } = signupNoticeMessage(input({ orgType: "BRAND", verificationSent: false }));
    expect(subject).toBe("New brand signup: Harbour Media");
    expect(text).toContain("Confirmation email to them: NOT sent");
  });

  it("keeps a typed name on one line in the subject", () => {
    const { subject } = signupNoticeMessage(input({ orgName: "Evil\r\nBcc: x@y.z\tCo" }));
    expect(subject).toBe("New agency signup: Evil Bcc: x@y.z Co");
    expect(subject).not.toMatch(/[\r\n\t]/);
  });
});

describe("notifyNewSignup", () => {
  it("sends one ops_signup mail to every ALERT_EMAIL_TO address, filed under the new org", async () => {
    await notifyNewSignup(input());
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0]).toMatchObject({
      kind: "ops_signup",
      to: ["ops@example.com", "second@example.com"],
      subject: "New agency signup: Harbour Media",
      orgId: "org-new",
      entityId: "user-new",
      replyTo: "asha@harbour.example",
    });
  });

  it("mails each signup, even two whose names differ only by a number", async () => {
    await notifyNewSignup(input({ orgName: "Studio 1" }));
    await notifyNewSignup(input({ orgName: "Studio 2", orgId: "org-2" }));
    expect(sendEmail.mock.calls.map((c) => c[0].subject)).toEqual([
      "New agency signup: Studio 1",
      "New agency signup: Studio 2",
    ]);
  });

  it("sends nothing when ALERT_EMAIL_TO is unset", async () => {
    process.env.ALERT_EMAIL_TO = "";
    await notifyNewSignup(input());
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("never throws, even if the mail layer does", async () => {
    sendEmail.mockRejectedValueOnce(new Error("provider down"));
    await expect(notifyNewSignup(input())).resolves.toBeUndefined();
  });
});
