/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

jest.mock(
  "@pratham7711/ui",
  () => ({
    Card: ({ children }: any) => <div>{children}</div>,
    Badge: ({ children }: any) => <span>{children}</span>,
    Skeleton: () => <div data-testid="skeleton" />,
    EmptyState: ({ title, description }: any) => (
      <div>
        <p>{title}</p>
        <p>{description}</p>
      </div>
    ),
    Button: ({ children, onClick, disabled }: any) => (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
  }),
  { virtual: true }
);

jest.mock("@/components/ds", () => {
  const { LoadError } = jest.requireActual("@/components/ds/LoadError");
  return {
    LoadError,
    PageHeader: ({ title }: any) => <h1>{title}</h1>,
    Button: ({ children, onClick, disabled }: any) => (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
  };
});

import CalendarPage from "@/app/(dashboard)/calendar/page";

/**
 * The month fetch used `.finally` with no `.catch`, so a failed request cleared
 * the spinner, left the arrays empty, and the grid announced "Nothing
 * scheduled" — an outage rendered as a fact about the org's calendar.
 */
describe("calendar — a month that could not be read", () => {
  it("says it failed instead of saying nothing is scheduled", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("offline")) as any;

    render(<CalendarPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load this month/i);
    expect(screen.queryByText("Nothing scheduled")).toBeNull();
  });

  it("still says nothing is scheduled when the month really is empty", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ campaigns: [], activations: [] }),
    }) as any;

    render(<CalendarPage />);

    await waitFor(() => expect(screen.getAllByText("Nothing scheduled").length).toBeGreaterThan(0));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("recovers on retry", async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true, json: async () => ({ campaigns: [], activations: [] }) });
    global.fetch = fetchMock as any;

    render(<CalendarPage />);
    fireEvent.click(await screen.findByText("Try again"));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
