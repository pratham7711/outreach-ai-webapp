/**
 * lib/notifications — catalog resolution, Slack webhook validation, and the
 * dispatch contract (never throws, respects per-user and per-org toggles,
 * excludes the actor).
 */

const mockOrgFindUnique = jest.fn();
const mockUserFindMany = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    organization: { findUnique: (...a: any[]) => mockOrgFindUnique(...a) },
    user: { findMany: (...a: any[]) => mockUserFindMany(...a) },
  },
}));

const mockSendEmail = jest.fn();
const mockEmailConfigured = jest.fn();
jest.mock("@/lib/email", () => ({
  sendEmail: (...a: any[]) => mockSendEmail(...a),
  emailConfigured: () => mockEmailConfigured(),
}));

import {
  NOTIFICATION_EVENTS,
  formatNotification,
  isNotifiableAction,
  isSlackWebhookUrl,
  notifyAuditEvent,
  readSlackIntegration,
  resolvePrefs,
} from "@/lib/notifications";

const fetchSpy = jest.fn();

beforeEach(() => {
  mockOrgFindUnique.mockReset();
  mockUserFindMany.mockReset();
  mockSendEmail.mockReset().mockResolvedValue({ sent: true });
  mockEmailConfigured.mockReset().mockReturnValue(true);
  fetchSpy.mockReset().mockResolvedValue({ ok: true, status: 200 });
  (global as any).fetch = fetchSpy;
});

describe("catalog", () => {
  it("has unique keys and a group for every event", () => {
    const keys = NOTIFICATION_EVENTS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of NOTIFICATION_EVENTS) expect(e.group.length).toBeGreaterThan(0);
  });

  it("keeps cron-fired events off by default", () => {
    const auto = NOTIFICATION_EVENTS.find((e) => e.key === "post.auto_approved");
    expect(auto?.defaultOn).toBe(false);
  });

  it("isNotifiableAction answers from the catalog", () => {
    expect(isNotifiableAction("campaign.create")).toBe(true);
    expect(isNotifiableAction("api_key.create")).toBe(false);
  });
});

describe("resolvePrefs", () => {
  it("fills defaults and applies boolean overrides", () => {
    const prefs = resolvePrefs({ "campaign.create": false, "post.create": true });
    expect(prefs["campaign.create"]).toBe(false);
    expect(prefs["post.create"]).toBe(true);
    expect(prefs["comment.create"]).toBe(true); // default on
  });

  it("ignores junk values and unknown shapes", () => {
    expect(resolvePrefs({ "campaign.create": "yes" })["campaign.create"]).toBe(true);
    expect(resolvePrefs(null)["campaign.create"]).toBe(true);
    expect(resolvePrefs([true])["campaign.create"]).toBe(true);
  });
});

describe("isSlackWebhookUrl", () => {
  it("accepts only https hooks.slack.com service URLs", () => {
    expect(isSlackWebhookUrl("https://hooks.slack.com/services/T0/B0/xyz")).toBe(true);
    expect(isSlackWebhookUrl("http://hooks.slack.com/services/T0/B0/xyz")).toBe(false);
    expect(isSlackWebhookUrl("https://evil.example.com/services/T0")).toBe(false);
    expect(isSlackWebhookUrl("https://hooks.slack.com/other/T0")).toBe(false);
    expect(isSlackWebhookUrl("not a url")).toBe(false);
  });
});

describe("readSlackIntegration", () => {
  it("digs the slack object out of uiConfig, tolerating absence at every level", () => {
    expect(readSlackIntegration(null)).toBeNull();
    expect(readSlackIntegration({})).toBeNull();
    expect(readSlackIntegration({ integrations: {} })).toBeNull();
    expect(
      readSlackIntegration({ integrations: { slack: { webhookUrl: "u", channel: "#c" } } })
    ).toEqual({ webhookUrl: "u", channel: "#c" });
  });
});

describe("formatNotification", () => {
  it("composes glyph, label, subject, actor", () => {
    const def = NOTIFICATION_EVENTS.find((e) => e.key === "campaign.create")!;
    expect(formatNotification(def, { entityLabel: "UFC EDITS", actorName: "Pratham" })).toBe(
      "🎉 Campaign Created — UFC EDITS · by Pratham"
    );
    expect(formatNotification(def, {})).toBe("🎉 Campaign Created");
  });
});

describe("notifyAuditEvent", () => {
  const org = (slack?: object) => ({
    name: "Org",
    uiConfig: slack ? { integrations: { slack } } : {},
  });
  const users = [
    { id: "u1", email: "a@x.com", name: "A", notificationPrefs: null },
    { id: "u2", email: "b@x.com", name: "B", notificationPrefs: { "campaign.create": false } },
  ];

  it("returns without touching the db for non-cataloged actions", async () => {
    await notifyAuditEvent({ orgId: "o1", action: "api_key.create" });
    expect(mockOrgFindUnique).not.toHaveBeenCalled();
  });

  /* Product email is limited to signup, password reset and invites. Activity
     notifications rode the audit stream and mailed the whole org -- creating a
     single campaign mailed every teammate -- so they send no email at all now,
     whatever a user's stored prefs say. This asserts the policy rather than the
     absence of a line of code: an opted-IN user and a default-on event is
     exactly the case that used to send. */
  it("sends no email for a notifiable action, even to opted-in users", async () => {
    mockOrgFindUnique.mockResolvedValue(org());
    mockUserFindMany.mockResolvedValue([
      ...users,
      { id: "actor", email: "actor@x.com", name: "Actor", notificationPrefs: null },
    ]);
    await notifyAuditEvent({
      orgId: "o1",
      action: "campaign.create",
      actorUserId: "actor",
      entityLabel: "UFC EDITS",
    });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("posts to Slack when connected and the event is on", async () => {
    mockOrgFindUnique.mockResolvedValue(
      org({ webhookUrl: "https://hooks.slack.com/services/T/B/x" })
    );
    mockUserFindMany.mockResolvedValue([]);
    await notifyAuditEvent({ orgId: "o1", action: "campaign.create", entityLabel: "Z" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/T/B/x");
    expect(JSON.parse(init.body).text).toContain("Campaign Created");
  });

  it("respects a per-org Slack event override", async () => {
    mockOrgFindUnique.mockResolvedValue(
      org({
        webhookUrl: "https://hooks.slack.com/services/T/B/x",
        events: { "campaign.create": false },
      })
    );
    mockUserFindMany.mockResolvedValue([]);
    await notifyAuditEvent({ orgId: "o1", action: "campaign.create" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips email entirely when the provider is not configured", async () => {
    mockEmailConfigured.mockReturnValue(false);
    mockOrgFindUnique.mockResolvedValue(org());
    mockUserFindMany.mockResolvedValue(users);
    await notifyAuditEvent({ orgId: "o1", action: "campaign.create" });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("never throws — a failing Slack POST and a db error are both swallowed", async () => {
    mockOrgFindUnique.mockRejectedValue(new Error("db down"));
    await expect(
      notifyAuditEvent({ orgId: "o1", action: "campaign.create" })
    ).resolves.toBeUndefined();

    mockOrgFindUnique.mockResolvedValue(
      org({ webhookUrl: "https://hooks.slack.com/services/T/B/x" })
    );
    mockUserFindMany.mockResolvedValue([]);
    fetchSpy.mockRejectedValue(new Error("network"));
    await expect(
      notifyAuditEvent({ orgId: "o1", action: "campaign.create" })
    ).resolves.toBeUndefined();
  });
});
