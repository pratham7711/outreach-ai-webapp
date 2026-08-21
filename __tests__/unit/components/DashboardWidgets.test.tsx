/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@pratham7711/ui", () => ({
  Card: ({ children, ...props }: any) => <div data-testid="card" {...props}>{children}</div>,
  Badge: ({ children }: any) => <span>{children}</span>,
  StatCard: ({ label, value }: any) => <div><span>{label}</span><span>{value}</span></div>,
  Skeleton: () => <div data-testid="skeleton" />,
}), { virtual: true });

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div data-testid="area" />,
  PieChart: ({ children }: any) => <div data-testid="pie-chart">{children}</div>,
  Pie: ({ children }: any) => <div data-testid="pie">{children}</div>,
  Cell: () => <div data-testid="cell" />,
  BarChart: ({ children }: any) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div data-testid="bar" />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));

import DashboardClient from "@/app/(dashboard)/dashboard/DashboardClient";

const baseProps = {
  campaignCount: 5,
  creatorCount: 20,
  recentCampaigns: [
    { id: "1", title: "Test Campaign", status: "PENDING", client: { name: "Acme" } },
  ],
};

const ALL_WIDGETS = [
  "kpi_grid",
  "views_over_time",
  "platform_breakdown",
  "top_posts",
  "campaign_reach",
  "creator_performance",
];

const emptyFinancials = {
  summary: {
    activeCampaigns: 0,
    totalCreators: 0,
  },
  viewsOverTime: [],
  viewsByCampaign: [],
  platformBreakdown: [],
  creatorPerformance: [],
  topPosts: [],
};

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => emptyFinancials,
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("DashboardClient — widget gating via dashboardWidgets", () => {
  it("renders every widget section when all keys are present", async () => {
    render(<DashboardClient {...baseProps} dashboardWidgets={ALL_WIDGETS} />);
    expect(await screen.findByText("Active campaigns")).toBeInTheDocument();
    expect(screen.getByText("Total views")).toBeInTheDocument();
    expect(screen.getByText("Views over time")).toBeInTheDocument();

    // Performance widgets live behind the Performance tab.
    fireEvent.click(screen.getByRole("tab", { name: /Performance/i }));
    expect(await screen.findByText("Views by platform")).toBeInTheDocument();
    expect(screen.getByText("Top posts")).toBeInTheDocument();
    expect(screen.getByText("Views by campaign")).toBeInTheDocument();
    expect(screen.getByText("Creator performance")).toBeInTheDocument();
  });

  it("hides the KPI grid when kpi_grid is absent", async () => {
    render(<DashboardClient {...baseProps} dashboardWidgets={["views_over_time"]} />);
    expect(await screen.findByText("Views over time")).toBeInTheDocument();
    expect(screen.queryByText("Active campaigns")).not.toBeInTheDocument();
    expect(screen.queryByText("Total views")).not.toBeInTheDocument();
  });

  it("hides the spend-over-time chart when views_over_time is absent", async () => {
    render(<DashboardClient {...baseProps} dashboardWidgets={["kpi_grid"]} />);
    expect(await screen.findByText("Active campaigns")).toBeInTheDocument();
    expect(screen.queryByText("Views over time")).not.toBeInTheDocument();
  });

  it("falls back to all default widgets when dashboardWidgets is null", async () => {
    render(<DashboardClient {...baseProps} dashboardWidgets={null} />);
    expect(await screen.findByText("Active campaigns")).toBeInTheDocument();
    expect(screen.getByText("Views over time")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Performance/i }));
    expect(await screen.findByText("Views by platform")).toBeInTheDocument();
    expect(screen.getByText("Top posts")).toBeInTheDocument();
    expect(screen.getByText("Creator performance")).toBeInTheDocument();
  });

  it("renders only the header chrome when dashboardWidgets is an empty array", async () => {
    render(<DashboardClient {...baseProps} dashboardWidgets={[]} />);
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Active campaigns")).not.toBeInTheDocument();
    expect(screen.queryByText("Views over time")).not.toBeInTheDocument();
    expect(screen.queryByText("Views by platform")).not.toBeInTheDocument();
  });
});
