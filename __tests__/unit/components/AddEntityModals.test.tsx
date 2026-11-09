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
    /* ds Field labels the input with <label for>, so the mock keeps the id it
       is given (and the required flag Field sets). */
    Input: ({ id, label, value, onChange, type, required, "aria-invalid": ariaInvalid }: any) => (
      <input id={id} aria-label={label} value={value} onChange={onChange} type={type} required={required} aria-invalid={ariaInvalid} />
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
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "@jane" } });
    submit("add-creator-form");

    expect(await screen.findByRole("alert")).toHaveTextContent(/session has expired/i);
    expect(onClose).not.toHaveBeenCalled();
  });

  /* Walkthrough 2026-10-13 R1: the form took "2.4m" followers and the roster
     then showed it as a measured 2,400,000. Figures are read from the
     platforms only, so the form has no field for them and sends none. */
  it("asks for no follower or view figure and sends none", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    global.fetch = fetchMock as any;

    render(<AddCreatorModal onClose={jest.fn()} />);
    expect(screen.queryByLabelText("Follower Count")).toBeNull();
    expect(screen.queryByLabelText("Avg Views")).toBeNull();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "@jane" } });
    submit("add-creator-form");

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("followersCount");
    expect(body).not.toHaveProperty("averageViews");
  });
});

/* Add waits for its required fields: the button stays disabled and a submit
   (Enter in a field) sends nothing until Name and Handle are both filled. */
describe("AddCreatorModal gating", () => {
  it("sends nothing while a required field is empty", () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;

    render(<AddCreatorModal onClose={jest.fn()} />);
    const add = screen.getByRole("button", { name: "Add creator" });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane" } });
    expect(add).toBeDisabled();
    submit("add-creator-form");
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "@jane" } });
    expect(add).toBeEnabled();
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
