/**
 * @jest-environment jsdom
 */
import React, { useState } from "react";
import { render, screen, fireEvent, waitFor, renderHook, act } from "@testing-library/react";

jest.mock(
  "@pratham7711/ui",
  () => ({
    Button: ({ children, variant, size, iconLeft, iconRight, loading, fullWidth, ...rest }: any) => (
      <button {...rest}>
        {iconLeft}
        {children}
      </button>
    ),
    Input: ({ label, error, iconLeft, iconRight, ...rest }: any) => <input {...rest} />,
    Textarea: ({ label, error, ...rest }: any) => <textarea {...rest} />,
  }),
  { virtual: true },
);

import { Field } from "@/components/ds/Field";
import { Dropdown } from "@/components/ds/Dropdown";
import { Modal } from "@/components/ds/Modal";
import { ConfirmProvider, useConfirm, resolveConfirm, type ConfirmOptions } from "@/components/ds/ConfirmDialog";
import { FilterDrawer, FilterButton, type FilterDef, type FilterValues } from "@/components/ds/FilterDrawer";
import { Input } from "@pratham7711/ui";
import { useDirty, sameValue } from "@/lib/useDirty";
import { Trash2, AlertTriangle } from "lucide-react";

describe("Field", () => {
  it("names its control with the label and marks it required without putting the asterisk in the name", () => {
    render(
      <Field label="Handle" required>
        <Input value="" onChange={() => {}} />
      </Field>,
    );
    const input = screen.getByLabelText("Handle");
    expect(input.tagName).toBe("INPUT");
    expect(input).toBeRequired();
    const label = document.querySelector("label.cc-form-label")!;
    expect(label).toHaveAttribute("data-required");
    expect(label.textContent).toBe("Handle");
  });

  it("points aria-describedby at the help line, and the error replaces it", () => {
    const { rerender } = render(
      <Field label="Name" helper="As it appears on contracts.">
        <Input value="" onChange={() => {}} />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).toHaveAccessibleDescription("As it appears on contracts.");
    expect(input).not.toHaveAttribute("aria-invalid");

    rerender(
      <Field label="Name" helper="As it appears on contracts." error="Enter a name.">
        <Input value="" onChange={() => {}} />
      </Field>,
    );
    expect(input).toHaveAccessibleDescription("Enter a name.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a name.");
    expect(screen.queryByText("As it appears on contracts.")).toBeNull();
  });

  it("keeps the control's own id and its own describedby", () => {
    render(
      <Field label="Rate" helper="Per post.">
        <input id="rate" aria-describedby="rate-currency" />
      </Field>,
    );
    const input = screen.getByLabelText("Rate");
    expect(input).toHaveAttribute("id", "rate");
    expect(input.getAttribute("aria-describedby")).toBe("rate-currency rate-help");
  });

  it("labels a Dropdown through its id and marks it aria-required, not required", () => {
    render(
      <Field label="Platform" required>
        <Dropdown value="" onChange={() => {}} options={[{ value: "TIKTOK", label: "TikTok" }]} placeholder="Pick one" />
      </Field>,
    );
    const trigger = screen.getByLabelText("Platform");
    expect(trigger).toHaveAttribute("role", "combobox");
    expect(trigger).toHaveAttribute("aria-required", "true");
    expect(trigger).not.toHaveAttribute("required");
  });

  it("labels a group of inputs as a group", () => {
    render(
      <Field label="Followers" group>
        <input aria-label="Minimum followers" />
        <input aria-label="Maximum followers" />
      </Field>,
    );
    const group = screen.getByRole("group", { name: "Followers" });
    expect(group).toContainElement(screen.getByLabelText("Minimum followers"));
  });
});

describe("useDirty", () => {
  type Form = { name: string; tags: string[] };
  const loaded: Form = { name: "Acme", tags: ["a"] };

  it("is never dirty before the snapshot exists", () => {
    const { result } = renderHook(() => useDirty<Form>(null, { name: "x", tags: [] }));
    expect(result.current).toBe(false);
  });

  it("compares by value, so typing a character and deleting it again is no change", () => {
    const { result, rerender } = renderHook(({ form }) => useDirty(loaded, form), {
      initialProps: { form: { name: "Acme", tags: ["a"] } as Form },
    });
    expect(result.current).toBe(false);
    rerender({ form: { name: "Acme!", tags: ["a"] } });
    expect(result.current).toBe(true);
    rerender({ form: { name: "Acme", tags: ["a"] } });
    expect(result.current).toBe(false);
    rerender({ form: { name: "Acme", tags: ["a", "b"] } });
    expect(result.current).toBe(true);
  });

  it("sameValue handles nested objects, arrays and dates", () => {
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(sameValue({ a: [1, { b: 2 }] }, { a: [1, { b: 3 }] })).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameValue(new Date(5), new Date(5))).toBe(true);
    expect(sameValue([1], { 0: 1 })).toBe(false);
  });
});

describe("ConfirmDialog subject and verb", () => {
  it("resolves verb + subject to one wording, a trash glyph and a Delete button", () => {
    const view = resolveConfirm({ verb: "delete", subject: "Summer drop" });
    expect(view).toMatchObject({
      danger: true,
      title: 'Delete "Summer drop"?',
      description: "This can't be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
    });
    expect(view.icon).toBe(Trash2);
    expect(resolveConfirm({ verb: "remove", subject: "Maya" }).confirmLabel).toBe("Remove");
  });

  it("keeps the undo note to destructive confirms, and explicit options win", () => {
    expect(resolveConfirm({ title: "Publish?", tone: "default" }).description).toBeUndefined();
    expect(resolveConfirm({ title: "Archive?" }).icon).toBe(AlertTriangle);
    expect(
      resolveConfirm({ verb: "delete", subject: "x", description: "Posts stay.", confirmLabel: "Delete list" }),
    ).toMatchObject({ description: "Posts stay.", confirmLabel: "Delete list" });
  });

  function Ask({ options, onAnswer }: { options: ConfirmOptions; onAnswer: (v: boolean) => void }) {
    const confirm = useConfirm();
    return <button onClick={() => confirm(options).then(onAnswer)}>ask</button>;
  }

  it("draws the resolved dialog and answers false on Cancel", async () => {
    const onAnswer = jest.fn();
    render(
      <ConfirmProvider>
        <Ask options={{ verb: "delete", subject: "Summer drop" }} onAnswer={onAnswer} />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByText("ask"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName('Delete "Summer drop"?');
    expect(dialog).toHaveTextContent("This can't be undone.");
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  });
});

describe("FilterDrawer", () => {
  /* jsdom lays nothing out, so offsetParent is always null and the Tab trap
     (which skips hidden controls by it) would see no controls at all. */
  const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return this.parentNode;
      },
    });
  });
  afterAll(() => {
    if (offsetParent) Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParent);
  });

  const FILTERS: FilterDef[] = [
    {
      type: "multiSelect",
      key: "platform",
      label: "Platform",
      options: [
        { value: "TIKTOK", label: "TikTok" },
        { value: "INSTAGRAM", label: "Instagram" },
      ],
    },
    { type: "numberRange", label: "Followers", minKey: "minF", maxKey: "maxF" },
  ];

  function Harness({ values = {}, onApply = () => {}, withDialog = false, onDialogClose = () => {} }: {
    values?: FilterValues;
    onApply?: (v: FilterValues) => void;
    withDialog?: boolean;
    onDialogClose?: () => void;
  }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <FilterButton count={0} onClick={() => setOpen(true)} />
        <FilterDrawer open={open} onClose={() => setOpen(false)} filters={FILTERS} values={values} onApply={onApply} />
        {withDialog && open && (
          <Modal open onClose={onDialogClose} title="On top">
            <button>inside</button>
          </Modal>
        )}
      </>
    );
  }

  const drawer = () => document.querySelector<HTMLElement>(".cc-drawer")!;

  it("moves focus into the panel on open, keeps Tab inside, and gives focus back to Filters on Escape", async () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Filters" });
    trigger.focus();
    fireEvent.click(trigger);

    await waitFor(() => expect(drawer().contains(document.activeElement)).toBe(true));
    expect(document.activeElement).toHaveAccessibleName("TikTok");

    const close = screen.getByRole("button", { name: "Close filters" });
    const max = screen.getByLabelText("Maximum Followers");
    max.focus();
    fireEvent.keyDown(max, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(max);

    fireEvent.keyDown(max, { key: "Escape" });
    expect(drawer()).toHaveAttribute("data-open", "false");
    expect(document.activeElement).toBe(trigger);
  });

  it("holds Apply until something changes and Clear all until something is set", async () => {
    const onApply = jest.fn();
    render(<Harness onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const apply = screen.getByRole("button", { name: "Apply" });
    const clear = screen.getByRole("button", { name: "Clear all" });
    expect(apply).toBeDisabled();
    expect(clear).toBeDisabled();

    fireEvent.click(screen.getByLabelText("TikTok"));
    expect(apply).toBeEnabled();
    expect(clear).toBeEnabled();
    fireEvent.click(screen.getByLabelText("TikTok"));
    expect(apply).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Minimum Followers"), { target: { value: "1000" } });
    fireEvent.click(apply);
    expect(onApply).toHaveBeenCalledWith({ platform: undefined, minF: "1000", maxF: undefined });
  });

  it("names the panel a dialog and its filters as groups", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("dialog", { name: "Filters" })).toBe(drawer());
    expect(screen.getByRole("group", { name: "Platform" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Followers" })).toBeInTheDocument();
  });

  it("lets Escape close only the top layer when a dialog sits over it", async () => {
    const onDialogClose = jest.fn();
    render(<Harness withDialog onDialogClose={onDialogClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    const inside = screen.getByRole("button", { name: "inside" });
    inside.focus();
    fireEvent.keyDown(inside, { key: "Escape" });
    expect(onDialogClose).toHaveBeenCalledTimes(1);
    expect(drawer()).toHaveAttribute("data-open", "true");
  });
});
