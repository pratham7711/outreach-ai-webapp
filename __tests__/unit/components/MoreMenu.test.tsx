/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MoreMenu } from "@/components/ds/MoreMenu";

function setup(over: { deleting?: boolean } = {}) {
  const duplicate = jest.fn();
  const remove = jest.fn();
  render(
    <MoreMenu
      label="More list actions"
      size="sm"
      items={[
        { label: "Export as CSV", href: "/api/lists/l1/export?format=csv", download: true },
        { label: "Duplicate list", onClick: duplicate, startsGroup: true },
        { label: over.deleting ? "Deleting…" : "Delete list", onClick: remove, danger: true, disabled: over.deleting },
      ]}
    />,
  );
  const button = screen.getByRole("button", { name: "More list actions" });
  return { button, duplicate, remove };
}

describe("MoreMenu", () => {
  it("is a squared library button named for what it holds", () => {
    const { button } = setup();
    expect(button).toHaveClass("ui-btn", "ui-btn-secondary", "ui-btn-sm", "cc-more-btn");
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("title", "More actions");
  });

  it("draws nothing when there is nothing to hold", () => {
    const { container } = render(<MoreMenu label="More" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("puts a rule above a new group and above the destructive item", () => {
    const { button } = setup();
    fireEvent.click(button, { detail: 1 });
    const menu = screen.getByRole("menu", { name: "More list actions" });
    const kinds = [...menu.children].map((el) => el.getAttribute("role") === "separator" ? "—" : el.textContent);
    expect(kinds).toEqual(["Export as CSV", "—", "Duplicate list", "—", "Delete list"]);
    expect(screen.getByRole("menuitem", { name: "Delete list" })).toHaveClass("ui-dropdown-item-danger");
  });

  it("draws a download as a link the browser saves", () => {
    const { button } = setup();
    fireEvent.click(button, { detail: 1 });
    const link = screen.getByRole("menuitem", { name: "Export as CSV" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/api/lists/l1/export?format=csv");
    expect(link).toHaveAttribute("download");
  });

  it("runs an item and closes", () => {
    const { button, duplicate } = setup();
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate list" }));
    expect(duplicate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps a disabled item announced but does not run it", () => {
    const { button, remove } = setup({ deleting: true });
    fireEvent.click(button, { detail: 1 });
    const item = screen.getByRole("menuitem", { name: "Deleting…" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("draws its menu on <body>, so a card's stacking context cannot paint over it", () => {
    const { button } = setup();
    fireEvent.click(button, { detail: 1 });
    const menu = screen.getByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveClass("cc-menu-portal");
    expect(button.closest(".ui-dropdown")!.contains(menu)).toBe(false);
  });

  it("a click on a portalled item is not an outside click", () => {
    const { button, duplicate } = setup();
    fireEvent.click(button, { detail: 1 });
    const item = screen.getByRole("menuitem", { name: "Duplicate list" });
    fireEvent.mouseDown(item);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.click(item);
    expect(duplicate).toHaveBeenCalledTimes(1);
  });

  it("a mousedown elsewhere closes it", () => {
    const { button } = setup();
    fireEvent.click(button, { detail: 1 });
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens from the keyboard on the first item; separators are not stops", () => {
    const { button } = setup();
    fireEvent.click(button, { detail: 0 });
    expect(screen.getByRole("menuitem", { name: "Export as CSV" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "Duplicate list" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "Delete list" })).toHaveFocus();
  });
});
