/**
 * @jest-environment jsdom
 *
 * The client report's audio card, in the states it will actually be in.
 *
 * A campaign's sound is usually the least-complete thing on the report: our
 * four tracked sounds carry no cover art, a sound attached today has one
 * reading and therefore no curve, and a tracker that stopped leaves month-old
 * figures sitting on a document that goes to a brand. Those three, plus the
 * rule that separates our first-reading arithmetic from the reference's, are
 * what this holds. The healthy case is a geometry question and was measured in
 * a browser against CreatorCore instead.
 */
jest.mock("recharts", () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div data-testid="area" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  Tooltip: () => <div data-testid="tooltip" />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock(
  "@pratham7711/ui",
  () => ({ Card: ({ children }: any) => <div>{children}</div> }),
  { virtual: true }
);

import { render, screen } from "@testing-library/react";
import { AudioCard } from "@/components/campaigns/AudioCard";
import type { CampaignAudio } from "@/lib/reports/campaignPerformance";

const DAY = 24 * 60 * 60 * 1000;

/** `daysAgo` places the NEWEST reading; the rest run back a day at a time. */
function audio(over: Partial<CampaignAudio> = {}, points = 3, daysAgo = 0): CampaignAudio {
  const usageSeries = Array.from({ length: points }, (_, i) => {
    const at = new Date(Date.now() - (daysAgo + (points - 1 - i)) * DAY).toISOString();
    return { date: at.slice(0, 10), at, uses: 30 + i * 10, velocity: i === 0 ? null : 12.5 };
  });
  return {
    title: "Roots",
    artist: "Jamie MacDonald & The Chosen",
    coverUrl: null,
    soundUrl: "https://www.tiktok.com/music/x-1",
    uses: 93,
    videosAdded24h: 63,
    usageSeries,
    ...over,
  };
}

it("shows the figures and the curve when the tracker is running", () => {
  render(<AudioCard audio={audio()} variant="report" />);

  expect(screen.getByText("TikTok Audio")).toBeInTheDocument();
  expect(screen.getByText("93")).toBeInTheDocument();
  expect(screen.getByText("+63")).toBeInTheDocument();
  expect(screen.getByTestId("area-chart")).toBeInTheDocument();
  // Nothing about staleness on a healthy card: this is where the reference
  // shows nothing, and the two must be identical there.
  expect(screen.queryByText(/Last read/)).not.toBeInTheDocument();
});

it("says so when the tracker has stopped, rather than passing old figures off as current", () => {
  render(<AudioCard audio={audio({}, 3, 29)} variant="report" />);

  expect(screen.getByText(/Last read 29 days ago/)).toBeInTheDocument();
  // The figures stay: the reading is old, not wrong.
  expect(screen.getByText("93")).toBeInTheDocument();
});

it("treats a reading from within the cron's cadence as current", () => {
  /* The nightly job runs at 04:00 UTC, so a reading a day or two old is the
     cadence working, not a failure -- flagging it would cry wolf on every
     healthy report. */
  render(<AudioCard audio={audio({}, 3, 2)} variant="report" />);

  expect(screen.queryByText(/Last read/)).not.toBeInTheDocument();
});

it("draws no chart from a single reading", () => {
  /* One point is not a curve. This is the state a sound is in the moment it is
     attached, before the first sync has a predecessor to compare against. */
  render(<AudioCard audio={audio({}, 1)} variant="report" />);

  expect(screen.queryByTestId("area-chart")).not.toBeInTheDocument();
  expect(screen.getByText(/synced more than once/)).toBeInTheDocument();
});

it("writes an em dash, not a zero, for a sound that has never been read", () => {
  /* Zero would claim the audio exists and nothing uses it. Never-read is not a
     measurement of zero, and the difference is the whole reason the reader
     reports which rung answered. */
  render(<AudioCard audio={audio({ uses: null, videosAdded24h: null }, 1)} variant="report" />);

  expect(screen.getAllByText("—")).toHaveLength(2);
  expect(screen.queryByText("0")).not.toBeInTheDocument();
});

it("falls back to a glyph when the sound has no cover art", () => {
  /* Every one of our four tracked sounds is in this state, so it is the
     default rather than the exception. */
  const { container } = render(<AudioCard audio={audio({ coverUrl: null })} variant="report" />);

  expect(container.querySelector("img.spr-audio-cover")).toBeNull();
  expect(container.querySelector(".spr-audio-cover-fallback")).not.toBeNull();
});

it("keeps the dashboard card on its own skin", () => {
  /* The report variant exists so the campaign tab does not move. If this ever
     renders .spr-* markup, the dashboard has been restyled by accident. */
  const { container } = render(<AudioCard audio={audio()} />);

  expect(container.querySelector(".spr-audio")).toBeNull();
  expect(screen.getByText("TikTok Audio")).toBeInTheDocument();
});
