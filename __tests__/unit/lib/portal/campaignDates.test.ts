import { campaignDates, nextCampaignDate } from "@/lib/portal/campaignDates";
import { campaignInvitePath, portalCampaignPath } from "@/lib/portal/invitePath";

describe("campaignDates", () => {
  it("returns nothing for a campaign with no dates at all", () => {
    expect(campaignDates({})).toEqual([]);
    expect(campaignDates({ deliverableDueDate: null, submissionDeadline: null, phases: [] })).toEqual([]);
  });

  it("lists every date earliest first, with the label the creator reads", () => {
    const dates = campaignDates({
      deliverableDueDate: new Date("2026-11-05T00:00:00Z"),
      submissionDeadline: "2026-11-20T00:00:00Z",
      phases: [{ name: "Teaser", startDate: "2026-11-01T00:00:00Z", endDate: "2026-11-10T00:00:00Z" }],
    });
    expect(dates).toEqual([
      { kind: "phase_start", label: "Teaser starts", at: "2026-11-01T00:00:00.000Z" },
      { kind: "post_due", label: "Your post is due", at: "2026-11-05T00:00:00.000Z" },
      { kind: "phase_end", label: "Teaser ends", at: "2026-11-10T00:00:00.000Z" },
      { kind: "submissions_close", label: "Submissions close", at: "2026-11-20T00:00:00.000Z" },
    ]);
  });

  /* join copies the deadline onto the activation, so the same instant would
     otherwise be listed twice under two names. */
  it("lists a due date copied from the deadline once, as the creator's own", () => {
    const at = new Date("2026-11-20T00:00:00Z");
    expect(campaignDates({ deliverableDueDate: at, submissionDeadline: at })).toEqual([
      { kind: "post_due", label: "Your post is due", at: at.toISOString() },
    ]);
  });

  it("skips a date that does not parse rather than throwing", () => {
    expect(campaignDates({ submissionDeadline: "not a date" })).toEqual([]);
  });
});

describe("nextCampaignDate", () => {
  const input = {
    deliverableDueDate: "2026-10-02T00:00:00Z",
    submissionDeadline: "2026-10-20T00:00:00Z",
  };

  it("keeps a date due today as next, all day", () => {
    expect(nextCampaignDate(input, new Date("2026-10-02T23:30:00Z"))?.kind).toBe("post_due");
  });

  it("moves on once the day has passed", () => {
    expect(nextCampaignDate(input, new Date("2026-10-03T00:00:01Z"))?.kind).toBe("submissions_close");
  });

  it("is null when every date is behind the campaign", () => {
    expect(nextCampaignDate(input, new Date("2026-12-01T00:00:00Z"))).toBeNull();
  });
});

describe("creator app paths", () => {
  it("lands an invite on its public page, not the POST-only API", () => {
    expect(campaignInvitePath("cinvtoken0000000000001")).toBe("/invite/cinvtoken0000000000001");
    expect(campaignInvitePath("a/b?c")).toBe("/invite/a%2Fb%3Fc");
  });

  it("opens a marketplace campaign by slug and a private one by id", () => {
    expect(portalCampaignPath({ id: "camp-1", publicSlug: "summer-drop" })).toBe("/portal/campaigns/summer-drop");
    expect(portalCampaignPath({ id: "camp-1", publicSlug: null })).toBe("/portal/campaigns/camp-1");
  });
});
