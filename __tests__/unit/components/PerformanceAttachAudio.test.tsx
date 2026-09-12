/**
 * @jest-environment jsdom
 *
 * Where the "track this campaign's audio" control lives.
 *
 * It first shipped as a secondary Button returned into the report's flex
 * column, which stretched it to the full content width between the KPI tiles
 * and the first chart -- a grey slab that read as a disabled banner. The
 * arrangement it was replaced with is the thing worth holding: a small action in
 * the header row beside Export and Share, and a form that opens down in the slot
 * the audio card will occupy, so what is being filled in appears where its
 * result will be.
 */
jest.mock("recharts", () => {
  const Pass = ({ children }: any) => <div>{children}</div>;
  return {
    AreaChart: Pass, Area: () => null, XAxis: () => null, YAxis: () => null,
    CartesianGrid: () => null, Tooltip: () => null, PieChart: Pass, Pie: Pass,
    Cell: () => null, Legend: () => null, ResponsiveContainer: Pass,
  };
});
jest.mock(
  "@pratham7711/ui",
  () => ({
    Card: ({ children }: any) => <div>{children}</div>,
    Badge: ({ children }: any) => <span>{children}</span>,
    EmptyState: ({ title }: any) => <div>{title}</div>,
    Skeleton: () => <div />,
    Avatar: () => <div />,
    Modal: ({ children }: any) => <div>{children}</div>,
    Input: ({ label, value, onChange }: any) => (
      <label>
        {label}
        <input aria-label={label} value={value} onChange={onChange} />
      </label>
    ),
  }),
  { virtual: true }
);
jest.mock("@/components/ds", () => ({
  ChartFrame: ({ children }: any) => <div>{children}</div>,
  MetricTile: ({ metric, value }: any) => <div>{`${metric}:${value}`}</div>,
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));
jest.mock("@/app/(dashboard)/campaigns/ShareModal", () => ({ ShareModal: () => <div /> }));
jest.mock("@/components/campaigns/AudioCard", () => ({
  AudioCard: ({ audio }: any) => <div>{`audio-card:${audio.title}`}</div>,
}));

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PerformanceTab from "@/app/(dashboard)/campaigns/[id]/PerformanceTab";

/** Enough of the report to get past the loading and no-posts branches. */
function payload(audio: unknown = null) {
  return {
    currency: "USD",
    kpis: {
      posts: 3, livePosts: 3, views: 1000, likes: null, comments: null, shares: null,
      saves: null, downloads: null, engagements: null, engagementRate: null,
    },
    timeSeries: [], seriesPlatforms: ["TIKTOK"], platformSplit: [],
    leaderboard: [{ creatorId: "c1", name: "A", avatarUrl: null, posts: 1, views: 1000, engagementRate: null }],
    posts: [], audio,
  };
}

function mockFetch(body: unknown) {
  return jest.fn().mockResolvedValue({ ok: true, json: async () => body });
}

afterEach(() => jest.restoreAllMocks());

it("offers the audio action in the header row, not as a block in the report", async () => {
  global.fetch = mockFetch(payload()) as unknown as typeof fetch;
  render(<PerformanceTab campaignId="camp-1" />);

  const trigger = await screen.findByRole("button", { name: /track audio/i });
  // Beside Export and Share rather than in the report's own column -- that
  // shared row is what keeps it from stretching to the content width.
  const row = trigger.parentElement!;
  expect(row).toContainElement(screen.getByRole("button", { name: /export/i }));
  expect(row).toContainElement(screen.getByRole("button", { name: /share report/i }));
  // Closed, it is one control and nothing else: no field, no card.
  expect(screen.queryByLabelText(/sound link/i)).not.toBeInTheDocument();
});

it("opens the form below the tiles and takes the trigger out of the header", async () => {
  global.fetch = mockFetch(payload()) as unknown as typeof fetch;
  render(<PerformanceTab campaignId="camp-1" />);

  await userEvent.click(await screen.findByRole("button", { name: /track audio/i }));

  expect(screen.getByLabelText(/sound link/i)).toBeInTheDocument();
  // Otherwise the header keeps offering to open what is already open.
  expect(screen.queryByRole("button", { name: /track audio/i })).not.toBeInTheDocument();
});

it("returns to the header action when the form is cancelled", async () => {
  global.fetch = mockFetch(payload()) as unknown as typeof fetch;
  render(<PerformanceTab campaignId="camp-1" />);

  await userEvent.click(await screen.findByRole("button", { name: /track audio/i }));
  await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

  expect(screen.queryByLabelText(/sound link/i)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /track audio/i })).toBeInTheDocument();
});

it("offers nothing to attach once the campaign has audio", async () => {
  global.fetch = mockFetch(payload({ title: "Roots", artist: "X", coverUrl: null, soundUrl: "u", uses: 1, videosAdded24h: null, usageSeries: [] })) as unknown as typeof fetch;
  render(<PerformanceTab campaignId="camp-1" />);

  await waitFor(() => expect(screen.getByText("audio-card:Roots")).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: /track audio/i })).not.toBeInTheDocument();
});
