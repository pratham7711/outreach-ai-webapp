import { render, screen } from "@testing-library/react";

// Mock @pratham7711/ui
jest.mock("@pratham7711/ui", () => ({
  Card: ({ children, ...props }: any) => <div data-testid="card" {...props}>{children}</div>,
  Badge: ({ children }: any) => <span>{children}</span>,
  StatCard: ({ label, value }: any) => <div><span>{label}</span><span>{value}</span></div>,
}), { virtual: true });

// Mock recharts to avoid canvas/SVG issues in jsdom
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div data-testid="area" />,
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

describe("DashboardClient — widget rendering based on dashboardWidgets", () => {
  it("renders all widgets when all keys are present in dashboard array", () => {
    const allWidgets = [
      "kpi_grid",
      "views_over_time",
      "platform_breakdown",
      "top_posts",
      "financial_summary",
      "creator_performance",
    ];
    render(<DashboardClient {...baseProps} dashboardWidgets={allWidgets} />);

    // kpi_grid: stat cards
    expect(screen.getByText("Total Campaigns")).toBeInTheDocument();
    expect(screen.getByText("Active Creators")).toBeInTheDocument();

    // views_over_time: chart
    expect(screen.getByText("Monthly Campaign Spend")).toBeInTheDocument();

    // placeholder widgets
    expect(screen.getByText("Platform Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Top Posts")).toBeInTheDocument();
    expect(screen.getByText("Financial Summary")).toBeInTheDocument();
    expect(screen.getByText("Creator Performance")).toBeInTheDocument();
  });

  it("hides kpi_grid when its key is removed from dashboard array", () => {
    const widgets = ["views_over_time"];
    render(<DashboardClient {...baseProps} dashboardWidgets={widgets} />);

    expect(screen.queryByText("Total Campaigns")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Creators")).not.toBeInTheDocument();
    // Chart should still show
    expect(screen.getByText("Monthly Campaign Spend")).toBeInTheDocument();
  });

  it("hides views_over_time chart when its key is removed", () => {
    const widgets = ["kpi_grid"];
    render(<DashboardClient {...baseProps} dashboardWidgets={widgets} />);

    expect(screen.getByText("Total Campaigns")).toBeInTheDocument();
    expect(screen.queryByText("Monthly Campaign Spend")).not.toBeInTheDocument();
  });

  it("renders placeholder widgets with 'Coming soon' text", () => {
    const widgets = ["platform_breakdown", "top_posts", "financial_summary", "creator_performance"];
    render(<DashboardClient {...baseProps} dashboardWidgets={widgets} />);

    const comingSoonElements = screen.getAllByTestId("placeholder-coming-soon");
    expect(comingSoonElements.length).toBe(4);
    comingSoonElements.forEach((el) => {
      expect(el).toHaveTextContent("Coming soon");
    });
  });

  it("handles null dashboardWidgets gracefully (shows all widgets as default)", () => {
    render(<DashboardClient {...baseProps} dashboardWidgets={null} />);

    // All default widgets should render
    expect(screen.getByText("Total Campaigns")).toBeInTheDocument();
    expect(screen.getByText("Monthly Campaign Spend")).toBeInTheDocument();
    expect(screen.getByText("Platform Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Top Posts")).toBeInTheDocument();
    expect(screen.getByText("Financial Summary")).toBeInTheDocument();
    expect(screen.getByText("Creator Performance")).toBeInTheDocument();
  });

  it("renders empty dashboard when dashboardWidgets is an empty array", () => {
    render(<DashboardClient {...baseProps} dashboardWidgets={[]} />);

    expect(screen.queryByText("Total Campaigns")).not.toBeInTheDocument();
    expect(screen.queryByText("Monthly Campaign Spend")).not.toBeInTheDocument();
    expect(screen.queryByText("Platform Breakdown")).not.toBeInTheDocument();
    // Header should still render
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });
});
