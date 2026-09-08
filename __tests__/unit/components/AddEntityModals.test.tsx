/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock(
  "@pratham7711/ui",
  () => ({
    Modal: ({ children, footer, title }: any) => (
      <div>
        <h2>{title}</h2>
        {children}
        {footer}
      </div>
    ),
    Input: ({ label, value, onChange, type, "aria-invalid": ariaInvalid }: any) => (
      <input aria-label={label} value={value} onChange={onChange} type={type} aria-invalid={ariaInvalid} />
    ),
  }),
  { virtual: true }
);

jest.mock("@/components/ds", () => ({
  Button: ({ children, loading, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled || loading}>
      {children}
    </button>
  ),
  Dropdown: ({ ariaLabel, value }: any) => <span aria-label={ariaLabel}>{value}</span>,
}));

import AddCreatorModal from "@/components/modals/AddCreatorModal";
import AddClientModal from "@/components/modals/AddClientModal";

const submit = (formId: string) =>
  fireEvent.submit(document.getElementById(formId) as HTMLFormElement);

beforeEach(() => {
  jest.clearAllMocks();
});

/**
 * Both modals used to do `if (res.ok) { … }` with no else, so a 409 on a
 * duplicate handle, a 400 from zod and a 401 from an expired session were all
 * indistinguishable from the button not being wired up.
 */
describe("AddCreatorModal", () => {
  it("shows the API's own message when the handle is already taken", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "A creator with the handle @jane already exists" }),
    }) as any;

    render(<AddCreatorModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "@jane" } });
    submit("add-creator-form");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "A creator with the handle @jane already exists"
    );
  });

  it("says the session expired on a 401 rather than closing silently", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }) as any;
    const onClose = jest.fn();

    render(<AddCreatorModal onClose={onClose} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
    submit("add-creator-form");

    expect(await screen.findByRole("alert")).toHaveTextContent(/session has expired/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sends a pasted '2.4m' as the integer the route expects", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as any;

    render(<AddCreatorModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "@jane" } });
    fireEvent.change(screen.getByLabelText("Follower Count"), { target: { value: "2.4m" } });
    fireEvent.change(screen.getByLabelText("Avg Views"), { target: { value: "890k" } });
    submit("add-creator-form");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.followersCount).toBe(2_400_000);
    expect(body.averageViews).toBe(890_000);
  });

  it("refuses an unparseable count in the form instead of posting a null", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    render(<AddCreatorModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText("Follower Count"), { target: { value: "loads" } });
    submit("add-creator-form");

    expect(await screen.findByRole("alert")).toHaveTextContent(/whole number/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("AddClientModal", () => {
  it("surfaces a rejected field instead of doing nothing", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Invalid input" }),
    }) as any;

    render(<AddClientModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Company Name"), { target: { value: "Sony" } });
    submit("add-client-form");

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid input");
  });

  /* The old code stringified an empty object unconditionally, so every client
     added without contact details carried the literal string "{}". */
  it("omits contactInfo entirely when no contact details were given", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as any;

    render(<AddClientModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Company Name"), { target: { value: "Sony" } });
    submit("add-client-form");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("contactInfo");
  });

  it("still sends the details that were given", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as any;

    render(<AddClientModal onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText("Company Name"), { target: { value: "Sony" } });
    fireEvent.change(screen.getByLabelText("Contact Email"), { target: { value: "a@b.com" } });
    submit("add-client-form");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(JSON.parse(body.contactInfo)).toEqual({ email: "a@b.com" });
  });
});
