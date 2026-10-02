import { fireEvent, render, screen } from "@testing-library/react";
import { MenuButton } from "@/components/ds/MenuButton";

/* The account menu and the bell moved off the ui package's Dropdown because it
   put aria-expanded on a bare div (axe: critical aria-allowed-attr on every
   page). These pin the replacement's semantics and keys. */
function setup(onOpen = jest.fn()) {
  const settings = jest.fn();
  const signOut = jest.fn();
  render(
    <MenuButton
      label="Account menu for Admin"
      align="right"
      onOpen={onOpen}
      trigger={<span>AD</span>}
      items={[
        { label: "Settings", onClick: settings },
        { label: "Sign out", danger: true, onClick: signOut },
      ]}
    />
  );
  return { button: screen.getByRole("button", { name: "Account menu for Admin" }), settings, signOut, onOpen };
}

describe("MenuButton", () => {
  it("is a real button that owns aria-haspopup and aria-expanded", () => {
    const { button } = setup();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens on click, names the menu, and reports the open once", () => {
    const { button, onOpen } = setup();
    fireEvent.click(button, { detail: 1 });
    expect(button).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Account menu for Admin" });
    expect(button).toHaveAttribute("aria-controls", menu.id);
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Settings", "Sign out"]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("puts a keyboard user on the first item and moves with the arrows", () => {
    const { button } = setup();
    fireEvent.click(button, { detail: 0 });
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: "ArrowDown" });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: "End" });
    expect(items[1]).toHaveFocus();
  });

  it("opens from ArrowDown on the closed button", () => {
    const { button } = setup();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    expect(screen.getAllByRole("menuitem")[0]).toHaveFocus();
  });

  it("closes on Escape and hands focus back to the button", () => {
    const { button } = setup();
    fireEvent.click(button, { detail: 0 });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("runs the item and closes", () => {
    const { button, signOut } = setup();
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on a click outside", () => {
    const { button } = setup();
    fireEvent.click(button, { detail: 1 });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
