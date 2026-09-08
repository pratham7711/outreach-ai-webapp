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
  PageHeader: ({ title }: any) => <h1>{title}</h1>,
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
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
    for (const label of ["With Deadlines", "Completed"]) {
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

    await waitFor(() => expect(screen.getByText("With Deadlines")).toBeInTheDocument());
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });
});
