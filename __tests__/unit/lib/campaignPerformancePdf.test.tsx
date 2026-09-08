/**
 * The share PDF's contents.
 *
 * It was a fraction of the web report at the same URL: Views / Engagements /
 * Eng. Rate / EMV / Budget, a platform split, and a ten-row creator
 * leaderboard. The web page also leads with Total Posts and lists every post
 * with its own counters, so a brand handed the PDF got a different — smaller —
 * report than a brand handed the link.
 *
 * @react-pdf/renderer ships ESM the runner does not transform, and its
 * primitives are layout containers with no behaviour worth exercising here, so
 * they are mocked down to DOM elements and the assertions read the text.
 */
jest.mock("@react-pdf/renderer", () => {
  const React = require("react");
  const box = (tag: string) =>
    function Box({ children }: { children?: React.ReactNode }) {
      return React.createElement(tag, null, children);
    };
  return {
    Document: box("div"),
    Page: box("div"),
    View: box("div"),
    Text: box("span"),
    StyleSheet: { create: (s: unknown) => s },
  };
});

import { render, screen } from "@testing-library/react";
import { CampaignPerformancePDF } from "@/lib/reports/CampaignPerformancePDF";
import { DEFAULT_SHARE_VISIBILITY } from "@/lib/reports/shareVisibility";

const post = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  platform: "TIKTOK",
  platformPostId: "1",
  postUrl: "https://www.tiktok.com/@mariasantos/video/1",
  thumbnailUrl: null,
  caption: "dancing to the track",
  postedAt: "2026-08-20T00:00:00.000Z",
  lastSyncedAt: null,
  creator: { id: "c1", name: "Maria Santos", handle: "mariasantos", avatarUrl: null },
  views: 22600,
  likes: 1200,
  comments: null,
  shares: null,
  saves: null,
  downloads: null,
  engagementRate: 0.05,
  removed: false,
  ...over,
});

const data = (over: Record<string, unknown> = {}) =>
  ({
    currency: "USD",
    kpis: {
      views: 22600,
      engagements: 1200,
      engagementRate: 0.05,
      emv: 250,
      posts: 1,
      livePosts: null,
      likes: 1200,
      comments: null,
      shares: null,
      saves: null,
      downloads: null,
    },
    timeSeries: [],
    platformSplit: [],
    leaderboard: [],
    posts: [post()],
    audio: null,
    ...over,
  }) as never;

function draw(over: Record<string, unknown> = {}, visibility = DEFAULT_SHARE_VISIBILITY) {
  render(
    <CampaignPerformancePDF campaignTitle="Wherever I go" data={data(over)} visibility={visibility} />
  );
}

it("leads with Total Posts, the tile the web report leads with", () => {
  draw();
  expect(screen.getByText("Total Posts")).toBeInTheDocument();
});

it("lists each post with its handle, platform, date and counters", () => {
  draw();
  expect(screen.getByText("@mariasantos")).toBeInTheDocument();
  expect(screen.getByText("TIKTOK")).toBeInTheDocument();
  expect(screen.getByText("Aug 20, 2026")).toBeInTheDocument();
  // An unmeasured counter is an em dash, never a zero a brand would read as
  // "this post earned no comments".
  expect(screen.getByText("—")).toBeInTheDocument();
});

it("drops the creator column on a link that hides creators", () => {
  // redactForShare nulls the creator on every row before the document sees it.
  draw({ posts: [post({ creator: null, postUrl: null, caption: null })] });
  expect(screen.queryByText("Creator")).not.toBeInTheDocument();
  expect(screen.queryByText("@mariasantos")).not.toBeInTheDocument();
  // The numbers are the point of the report and survive.
  expect(screen.getByText("Posts")).toBeInTheDocument();
  expect(screen.getByText("TIKTOK")).toBeInTheDocument();
});

it("caps the table and says how many rows it did not print", () => {
  const many = Array.from({ length: 250 }, (_, i) => post({ id: `p${i}` }));
  draw({ posts: many, kpis: { ...(data() as any).kpis, posts: 250 } });
  expect(screen.getAllByText("TIKTOK")).toHaveLength(200);
  expect(screen.getByText(/\+50 more posts not shown/)).toBeInTheDocument();
});

it("says so plainly when a campaign has no posts", () => {
  draw({ posts: [], kpis: { ...(data() as any).kpis, posts: 0 } });
  expect(screen.getByText("No posts yet.")).toBeInTheDocument();
});
