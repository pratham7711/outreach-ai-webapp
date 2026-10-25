/**
 * @jest-environment jsdom
 */
/**
 * My stats draws only what a platform returned. A figure, count, chart or
 * section the API left out is not drawn at all -- no dash, no empty frame, no
 * zero -- and where a headline figure is missing, one line names it.
 */
import { render, screen, within } from "@testing-library/react";
import type { InstagramInsightsBody } from "@/lib/portal/instagramInsightsRead";
import type { InsightsPost, PlatformInsights } from "@/lib/portal/creatorInsights";
import { InstagramInsightsView } from "@/components/insights/InstagramInsightsPanel";
import { AccountHero } from "@/components/portal/stats/AccountChrome";
import PostGrid from "@/components/portal/stats/PostGrid";
import CampaignPosts, { type CampaignPost } from "@/components/portal/stats/CampaignPosts";
import GrowthPanel from "@/components/portal/stats/GrowthPanel";

const body = (over: Partial<InstagramInsightsBody["account"]> = {}, stories: InstagramInsightsBody["stories"] = []): InstagramInsightsBody => ({
  handle: "mia",
  readAt: "2026-10-25T00:00:00Z",
  stored: false,
  account: {
    since: "2026-09-27",
    until: "2026-10-25",
    days: 28,
    totals: {},
    followerSeries: null,
    demographics: { age: [], gender: [], country: [] },
    ...over,
  },
  stories,
});

const post = (over: Partial<InsightsPost> = {}): InsightsPost => ({
  id: Math.random().toString(36).slice(2),
  caption: "A post",
  views: null,
  likes: 10,
  comments: 2,
  shares: null,
  postedAt: "2026-10-20T00:00:00Z",
  shareUrl: null,
  coverImageUrl: null,
  ...over,
});

const block = (over: Partial<PlatformInsights> = {}): PlatformInsights => ({
  accountId: "a1",
  platform: "INSTAGRAM",
  connected: true,
  needsReconnect: false,
  handle: "mia",
  displayName: "Mia",
  avatarUrl: null,
  bio: null,
  profileUrl: null,
  isVerified: false,
  followers: 1200,
  following: null,
  totalLikes: null,
  mediaCount: null,
  sampleSize: 0,
  totalViews: null,
  medianViews: null,
  medianReach: null,
  bestPost: null,
  posts: [],
  ...over,
});

describe("Instagram insights with nothing returned", () => {
  it("draws no chart or section, and names every figure it left out", () => {
    const { container } = render(<InstagramInsightsView data={body()} />);
    expect(screen.queryByText("New followers per day")).toBeNull();
    expect(screen.queryByText("Who follows you")).toBeNull();
    expect(screen.queryByText("What people did")).toBeNull();
    expect(screen.queryByText("Stories live now")).toBeNull();
    expect(container.querySelector("dl")).toBeNull();
    expect(container.textContent).not.toContain("—");
    expect(screen.getByText(/did not return accounts reached, views, accounts engaged and new followers/)).toBeTruthy();
    expect(screen.getByText(/No story is live right now/)).toBeTruthy();
    expect(screen.getByText(/only once it has 100 followers/)).toBeTruthy();
  });
});

describe("Instagram insights with part returned", () => {
  it("shows the figures that came back and names only the rest", () => {
    render(<InstagramInsightsView data={body({ totals: { reach: 5000, likes: 300 } })} />);
    expect(screen.getByText("Accounts reached")).toBeTruthy();
    expect(screen.queryByText("Accounts engaged")).toBeNull();
    expect(screen.getByText(/did not return views, accounts engaged and new followers/)).toBeTruthy();
    expect(screen.getByText("What people did")).toBeTruthy();
    expect(screen.queryByText("Profile views")).toBeNull();
    expect(screen.queryByText("Interactions in all")).toBeNull();
  });

  it("lists only the story figures Instagram returned", () => {
    render(
      <InstagramInsightsView
        data={body({}, [
          { id: "s1", mediaType: "IMAGE", thumbnailUrl: null, permalink: null, postedAt: null, metrics: { reach: 40, views: 52 }, navigation: {} },
        ])}
      />,
    );
    const story = screen.getByText("Stories live now").closest("section") as HTMLElement;
    expect(within(story).getByText("Reach")).toBeTruthy();
    expect(within(story).queryByText("Replies")).toBeNull();
    expect(within(story).queryByText("How viewers moved on")).toBeNull();
    expect(story.textContent).not.toContain("—");
  });
});

describe("Growth panel", () => {
  it("offers no daily view when Instagram returned no days, and is left out with no readings at all", () => {
    const { container } = render(<GrowthPanel trend={null} instagram={body()} unit="followers" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("Account hero", () => {
  it("shows only the counts the platform returned", () => {
    render(<AccountHero block={block({ followers: 1200, following: null, mediaCount: 48 })} />);
    expect(screen.getByText(/followers/)).toBeTruthy();
    expect(screen.queryByText(/following/)).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
  });
});

describe("Post grid", () => {
  it("drops the views overlay and the sorts no post can be ranked by", () => {
    const posts = [post(), post(), post()];
    render(<PostGrid block={block({ platform: "FACEBOOK", posts, sampleSize: 3 })} />);
    expect(screen.queryByText("Most viewed")).toBeNull();
    expect(screen.queryByText(/ views$/)).toBeNull();
    expect(screen.queryByText("Newest")).toBeNull();
  });

  it("keeps a sort when some post carries its figure", () => {
    const posts = [post({ views: 900 }), post({ views: 300 }), post()];
    render(<PostGrid block={block({ platform: "TIKTOK", posts, sampleSize: 3, medianViews: 600 })} />);
    expect(screen.getByText("Most viewed")).toBeTruthy();
    expect(screen.getByText("Most engaging")).toBeTruthy();
  });

  it("leaves a count off a tile that did not return it", () => {
    render(<PostGrid block={block({ platform: "YOUTUBE", posts: [post({ views: 100, likes: null })], sampleSize: 1 })} />);
    expect(screen.queryByText("likes")).toBeNull();
    expect(screen.queryByText(/shares/)).toBeNull();
  });
});

describe("Campaign posts", () => {
  const cp = (over: Partial<CampaignPost> = {}): CampaignPost => ({
    id: Math.random().toString(36).slice(2),
    platform: "TIKTOK",
    postUrl: "https://example.com/p",
    caption: null,
    postedAt: "2026-10-20T00:00:00Z",
    campaignTitle: "Launch",
    views: null,
    likes: 5,
    comments: 1,
    reach: null,
    saves: null,
    ...over,
  });

  it("draws a column only when some post has a figure for it", () => {
    const { container } = render(<CampaignPosts posts={[cp(), cp({ platform: "INSTAGRAM", reach: 800 })]} />);
    const heads = Array.from(container.querySelectorAll("th")).map((th) => th.textContent);
    expect(heads).toEqual(["Post", "Likes", "Comments", "Reach"]);
  });
});
