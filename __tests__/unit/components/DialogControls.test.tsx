/**
 * @jest-environment jsdom
 */
import React, { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

jest.mock(
  "@pratham7711/ui",
  () => ({
    Button: ({ children, variant, size, iconLeft, iconRight, loading, fullWidth, ...rest }: any) => (
      <button {...rest}>
        {iconLeft}
        {children}
      </button>
    ),
  }),
  { virtual: true },
);

import { Modal, type ModalTone } from "@/components/ds/Modal";
import { ConfirmProvider, useConfirm } from "@/components/ds/ConfirmDialog";
import { Combobox } from "@/components/ds/Combobox";
import { EntityPicker, type PickerOption } from "@/components/ds/EntityPicker";

const Glyph = () => <svg />;

describe("Modal featured icon", () => {
  it.each<[ModalTone, boolean]>([
    ["brand", false],
    ["neutral", false],
    ["info", false],
    ["danger", true],
    ["warning", true],
    ["success", true],
  ])("tone %s draws the icon: %s", (tone, drawn) => {
    render(
      <Modal open onClose={() => {}} title="A dialog" icon={Glyph} tone={tone}>
        body
      </Modal>,
    );
    expect(document.querySelector(".cc-dialog__icon") !== null).toBe(drawn);
  });
});

function Ask({ tone }: { tone: "danger" | "default" }) {
  const confirm = useConfirm();
  return <button onClick={() => confirm({ title: "Delete this list?", tone })}>ask</button>;
}

describe("ConfirmDialog initial focus", () => {
  it("opens a destructive confirm on Cancel, so Enter keeps the data", () => {
    render(
      <ConfirmProvider>
        <Ask tone="danger" />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByText("ask"));
    expect(document.activeElement).toHaveTextContent("Cancel");
  });

  it("opens a harmless confirm on its confirm button", () => {
    render(
      <ConfirmProvider>
        <Ask tone="default" />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByText("ask"));
    expect(document.activeElement).toHaveTextContent("Confirm");
  });
});

function TagHarness({ onSubmit, onClose }: { onSubmit: (v: string) => void; onClose: () => void }) {
  const [tag, setTag] = useState("");
  return (
    <Modal open onClose={onClose} title="Tag creators">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(tag);
        }}
      >
        <Combobox label="Tag" value={tag} onChange={setTag} options={["summer", "skincare", "gaming"]} />
      </form>
    </Modal>
  );
}

describe("Combobox", () => {
  it("lists the existing values on a click, not on focus, and filters as you type", () => {
    render(<TagHarness onSubmit={jest.fn()} onClose={jest.fn()} />);
    const input = screen.getByRole("combobox", { name: "Tag" });
    expect(document.querySelector("datalist")).toBeNull();

    fireEvent.focus(input);
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(input);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["summer", "skincare", "gaming"]);

    fireEvent.change(input, { target: { value: "s" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["summer", "skincare"]);
  });

  it("Enter on a highlighted option picks it instead of submitting the form", () => {
    const onSubmit = jest.fn();
    render(<TagHarness onSubmit={onSubmit} onClose={jest.fn()} />);
    const input = screen.getByRole("combobox", { name: "Tag" });
    fireEvent.click(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant");

    const notPrevented = fireEvent.keyDown(input, { key: "Enter" });
    expect(notPrevented).toBe(false);
    expect(input).toHaveValue("summer");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();

    // With the list closed, Enter is the form's again.
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(true);
  });

  it("Escape closes the list first and the dialog only on the next press", () => {
    const onClose = jest.fn();
    render(<TagHarness onSubmit={jest.fn()} onClose={onClose} />);
    const input = screen.getByRole("combobox", { name: "Tag" });
    fireEvent.click(input);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function PickerHarness({ onPick, onClose }: { onPick: (o: PickerOption | null) => void; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Merge a duplicate">
      <EntityPicker
        id="dup"
        endpoint="/api/creators"
        extract={(j) => j.creators.map((c: any) => ({ id: c.id, label: c.name }))}
        value={null}
        onChange={onPick}
        placeholder="Search by name or handle…"
      />
    </Modal>
  );
}

describe("EntityPicker", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ creators: [{ id: "c1", name: "Felix Moreau" }, { id: "c2", name: "Fatima Noor" }] }),
    }) as any;
  });

  it("portals its results outside the dialog, so the dialog body cannot cut them off", async () => {
    render(<PickerHarness onPick={jest.fn()} onClose={jest.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.click(input);
    await screen.findByText("Felix Moreau");
    const list = screen.getByRole("listbox");
    expect(list.parentElement).toBe(document.body);
    expect(document.querySelector(".cc-dialog")!.contains(list)).toBe(false);
  });

  it("reaches the options with the arrow keys and picks with Enter", async () => {
    const onPick = jest.fn();
    render(<PickerHarness onPick={onPick} onClose={jest.fn()} />);
    const input = screen.getByRole("combobox");
    fireEvent.click(input);
    await screen.findByText("Fatima Noor");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith({ id: "c2", label: "Fatima Noor" });
  });

  it("Escape closes the results without closing the dialog", async () => {
    const onClose = jest.fn();
    render(<PickerHarness onPick={jest.fn()} onClose={onClose} />);
    const input = screen.getByRole("combobox");
    fireEvent.click(input);
    await screen.findByText("Felix Moreau");

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });
});
