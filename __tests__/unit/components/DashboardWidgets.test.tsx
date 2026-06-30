/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";

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
  pendingPayouts: 1500,
  recentCampaigns: [
    { id: "1", title: "Test Campaign", status: "PENDING", budget: 1000, client: { name: "Acme" } },
  ],
  chartData: [{ month: "Jan", spend: 500 }],
};

const ALL_WIDGETS = [
  "kpi_grid",
  "views_over_time",
  "platform_breakdown",
  "top_posts",
  "financial_summary",
  "creator_performance",
];

const emptyFinancials = {
  summary: {
    totalSpend: 0,
    totalBudget: 0,
    budgetUtilization: 0,
    activeCampaigns: 0,
    totalCreators: 0,
    avgCampaignSpend: 0,
    pendingPayouts: 0,
    totalDeposits: 0,
    releasedDeposits: 0,
  },
  spendOverTime: [],
  spendByCampaign: [],
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
    expect(await screen.findByText("Total Spend")).toBeInTheDocument();
    expect(screen.getByText("Active Campaigns")).toBeInTheDocument();
    expect(screen.getByText("Spend & Views Over Time")).toBeInTheDocument();
    expect(screen.getByText("Platform Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Top Posts")).toBeInTheDocument();
    expect(screen.getByText("Spend by Campaign")).toBeInTheDocument();
    expect(screen.getByText("Creator Performance")).toBeInTheDocument();
  });

  it("hides the KPI grid when kpi_grid is absent", async () => {
    render(<DashboardClient {...baseProps} dashboardWidgets={["views_over_time"]} />);
    expect(await screen.findByText("Spend & Views Over Time")).toBeInTheDocument();
    expect(screen.queryByText("Total Spend")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Campaigns")).not.toBeInTheDocument();
  });

  it("hides the spend-over-time chart when views_over_time is absent", async () => {
    render(<DashboardClient {...baseProps} dashboardWidgets={["kpi_grid"]} />);
    expect(await screen.findByText("Total Spend")).toBeInTheDocument();
    expect(screen.queryByText("Spend & Views Over Time")).not.toBeInTheDocument();
  });

  it("falls back to all default widgets when dashboardWidgets is null", async () => {
    render(<DashboardClient {...baseProps} dashboardWidgets={null} />);
    expect(await screen.findByText("Total Spend")).toBeInTheDocument();
    expect(screen.getByText("Spend & Views Over Time")).toBeInTheDocument();
    expect(screen.getByText("Platform Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Top Posts")).toBeInTheDocument();
    expect(screen.getByText("Creator Performance")).toBeInTheDocument();
  });

  it("renders only the header chrome when dashboardWidgets is an empty array", async () => {
    render(<DashboardClient {...baseProps} dashboardWidgets={[]} />);
    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Total Spend")).not.toBeInTheDocument();
    expect(screen.queryByText("Spend & Views Over Time")).not.toBeInTheDocument();
    expect(screen.queryByText("Platform Breakdown")).not.toBeInTheDocument();
  });
});
