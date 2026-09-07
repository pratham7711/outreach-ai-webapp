import { render, screen, waitFor } from "@testing-library/react";

jest.mock(
  "@pratham7711/ui",
  () => ({
    Card: ({ children, variant: _v, ...props }: any) => <div {...props}>{children}</div>,
    Skeleton: () => <div data-testid="skeleton" />,
  }),
  { virtual: true },
);
jest.mock("@/components/ds", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
jest.mock("lucide-react", () => ({
  BadgeCheck: () => <span />,
  ExternalLink: () => <span />,
}));

jest.mock("@/components/portal/ConnectPrompt", () => ({
  ConnectPrompt: () => <div>connect prompt</div>,
}));

import { MyPerformance } from "@/components/portal/MyPerformance";

const post = (id: string, views: number | null, likes: number) => ({
  id,
  caption: `Post ${id}`,
  views,
  likes,
  comments: 2,
  shares: 0,
  postedAt: "2026-09-01T00:00:00Z",
  shareUrl: null,
  coverImageUrl: null,
});

const block = (over: Record<string, unknown>) => ({
  accountId: "sa1",
  platform: "THREADS",
  connected: true,
  needsReconnect: false,
  handle: "prathams7711",
  avatarUrl: null,
  bio: null,
  profileUrl: null,
  isVerified: false,
  followers: 83,
  following: null,
  totalLikes: null,
  mediaCount: null,
  sampleSize: 1,
  totalViews: 1,
  medianViews: 1,
  bestPost: post("t1", 1, 0),
  posts: [post("t1", 1, 0)],
  ...over,
});

function mockInsights(platforms: unknown[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ connected: true, platforms }),
  }) as unknown as typeof fetch;
}

describe("MyPerformance — stats the platform did not report", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("omits header stats the platform has no metric for, instead of showing a dash", async () => {
    /* Threads and Facebook Pages expose no following, total-likes or lifetime
       post count. Three dashes in a six-cell grid read as a broken page. */
    mockInsights([block({})]);
    render(<MyPerformance />);
    await waitFor(() => expect(screen.getByText("Followers")).toBeInTheDocument());
    expect(screen.getByText("83")).toBeInTheDocument();
    expect(screen.getByText("Views (recent posts)")).toBeInTheDocument();
    expect(screen.queryByText("Following")).toBeNull();
    expect(screen.queryByText("Total likes")).toBeNull();
    expect(screen.queryByText("Posts published")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("drops the views counter from a post row when the platform withheld it, and never shows 0", async () => {
    /* The Instagram shape: likes and comments real, insights refused. */
    mockInsights([
      block({
        platform: "INSTAGRAM",
        following: 611,
        mediaCount: 10,
        totalViews: null,
        medianViews: null,
        sampleSize: 10,
        bestPost: post("m1", null, 223),
        posts: [post("m1", null, 223)],
      }),
    ]);
    render(<MyPerformance />);
    await waitFor(() => expect(screen.getByText("Followers")).toBeInTheDocument());
    expect(screen.getByText("611")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.queryByText("Views (recent posts)")).toBeNull();
    expect(screen.queryByText("Median views per post")).toBeNull();
    expect(screen.getAllByText("223 likes · 2 comments · 0 shares").length).toBeGreaterThan(0);
    expect(screen.queryByText(/0 views/)).toBeNull();
    expect(screen.queryByText(/— views/)).toBeNull();
  });

  it("keeps the views counter when it was measured", async () => {
    mockInsights([block({ bestPost: post("t1", 1200, 40), posts: [post("t1", 1200, 40)] })]);
    render(<MyPerformance />);
    await waitFor(() =>
      expect(screen.getAllByText("1.2K views · 40 likes · 2 comments · 0 shares").length).toBeGreaterThan(0),
    );
  });
});
