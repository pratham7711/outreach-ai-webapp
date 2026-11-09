/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/react";

jest.mock(
  "@pratham7711/ui",
  () => ({
    Card: ({ children }: any) => <div>{children}</div>,
    Badge: ({ children }: any) => <span>{children}</span>,
    Skeleton: () => <div data-testid="skeleton" />,
    EmptyState: ({ title, description }: any) => (
      <div data-testid="empty-state">
        <p>{title}</p>
        <p>{description}</p>
      </div>
    ),
  }),
  { virtual: true }
);

jest.mock("@/components/ds", () => ({
  PageHeader: ({ title, tabs }: { title: React.ReactNode; tabs?: React.ReactNode }) => (
    <header>
      <h1>{title}</h1>
      {tabs}
    </header>
  ),
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  StatusTabs: ({ tabs }: { tabs: { key: string; label: string }[] }) => (
    <div role="tablist">
      {tabs.map((t) => (
        <button key={t.key} role="tab">
          {t.label}
        </button>
      ))}
    </div>
  ),
  MetricTile: ({ label, value }: { label: React.ReactNode; value: React.ReactNode }) => (
    <div>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  ),
  Skeleton: () => <div data-testid="skeleton" />,
  StatusBadge: ({ status, children }: { status?: string; children?: React.ReactNode }) => <span>{children ?? status}</span>,
  LoadError: ({ title }: { title?: string }) => <div role="alert">{title}</div>,
  NoResults: ({ title, description }: { title: string; description?: React.ReactNode }) => (
    <div data-testid="no-results">
      <p>{title}</p>
      <p>{description}</p>
    </div>
  ),
  DataTable: ({ rows, empty, loading }: { rows: unknown[]; empty?: React.ReactNode; loading?: boolean }) =>
    loading && rows.length === 0 ? <div data-testid="table-loading" /> : rows.length === 0 ? <div>{empty}</div> : <table />,
}));

import DeadlinesPage from "@/app/(dashboard)/deadlines/page";

const EMPTY_STATS = { total: 0, overdue: 0, dueThisWeek: 0, completed: 0, noDate: 0 };

function respond(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body }) as any;
}

/**
 * Five stat cards all reading 0, stacked above "No deadlines found" — five
 * measurements of nothing, presented with the authority of a figure, on a
 * screen a new org reaches before it has a single activation.
 */
describe("deadlines — a workspace with nothing in it", () => {
  it("hides the counter tiles entirely rather than printing five zeroes", async () => {
    respond({ activations: [], stats: EMPTY_STATS });
    render(<DeadlinesPage />);

    await screen.findByTestId("empty-state");
    // Only the two tile labels that are not also filter tabs; the tabs stay put.
    for (const label of ["With deadlines", "Completed"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it("does not tell a first-time visitor to adjust a filter they never set", async () => {
    respond({ activations: [], stats: EMPTY_STATS });
    render(<DeadlinesPage />);

    const empty = await screen.findByTestId("empty-state");
    expect(empty).not.toHaveTextContent(/filter/i);
    expect(empty).toHaveTextContent(/Due dates you set/i);
  });

  it("shows the tiles again as soon as there is something to count", async () => {
    respond({ activations: [], stats: { ...EMPTY_STATS, total: 3, noDate: 1 } });
    render(<DeadlinesPage />);

    await waitFor(() => expect(screen.getByText("With deadlines")).toBeInTheDocument());
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });
});
