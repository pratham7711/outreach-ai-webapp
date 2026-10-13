/**
 * @jest-environment jsdom
 *
 * "Close campaign" went to a bare /campaigns (the Active tab) whatever list the
 * campaign was opened from. It now returns to the remembered list URL -- and
 * only ever to a /campaigns list URL.
 */
import { campaignListHref, rememberCampaignList } from "@/lib/campaigns/listReturn";

beforeEach(() => window.sessionStorage.clear());

describe("campaign list return", () => {
  it("falls back to /campaigns before any list was seen", () => {
    expect(campaignListHref()).toBe("/campaigns");
  });

  it("returns to the list the campaign was opened from", () => {
    rememberCampaignList("/campaigns?status=ALL&page=4");
    expect(campaignListHref()).toBe("/campaigns?status=ALL&page=4");
  });

  it.each(["/campaigns/camp-1", "//evil.com/campaigns", "https://evil.com/campaigns", "/campaignsx", "/dashboard"])(
    "refuses to remember %s",
    (url) => {
      rememberCampaignList(url);
      expect(campaignListHref()).toBe("/campaigns");
    },
  );

  it("ignores anything else stored under the key", () => {
    window.sessionStorage.setItem("cc:campaigns:listUrl", "https://evil.com/");
    expect(campaignListHref()).toBe("/campaigns");
  });
});
