"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/**
 * A button that opens a menu of actions: the account menu and the bell.
 *
 * Both used the ui package's Dropdown, which puts aria-haspopup and
 * aria-expanded on a bare <div> inside whatever wrapper it is given. A div has
 * no role that allows aria-expanded, so axe reported a critical
 * aria-allowed-attr failure on every page that has the top bar. Here the
 * trigger is a real <button> and carries both attributes itself.
 *
 * It reuses the package's ui-dropdown classes, so the menu looks as it did,
 * and keeps its keys: Enter, Space or ArrowDown open it on the first item, the
 * arrows, Home and End move, Escape closes and hands focus back to the
 * button, and a click outside closes it.
 */

export type MenuButtonItem = {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onClick?: () => void;
  /* The three below exist for the bell, and default to how every other menu
     already behaves. */
  /** Leave the menu open after this item runs: an action that changes the
   *  menu itself (Mark all as read, Show more) should show its result. */
  keepOpen?: boolean;
  /** Bold label, for a line that has not been read. */
  strong?: boolean;
  /** Drawn after the label, e.g. an unread dot. */
  trailing?: ReactNode;
};

export function MenuButton({
  trigger,
  items,
  label,
  align = "left",
  onOpen,
  menuStyle,
}: {
  trigger: ReactNode;
  items: MenuButtonItem[];
  /** The button's accessible name, also given to the menu. */
  label: string;
  align?: "left" | "right";
  onOpen?: () => void;
  /** Extra style for the open menu, e.g. a max height for a long list. */
  menuStyle?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setActive(-1);
    if (refocus) button.current?.focus();
  }, []);

  const show = (first: number) => {
    setOpen(true);
    setActive(first);
    onOpen?.();
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) close(false);
    };
    const escape = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);

  useEffect(() => {
    if (!open || active < 0) return;
    menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus();
  }, [open, active]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = items.length - 1;
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        show(0);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? last : i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(last);
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  return (
    <div ref={root} className="ui-dropdown" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="ui-dropdown-trigger cc-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        /* A click with detail 0 came from Enter or Space, so the keyboard
           user lands on the first item; a pointer click leaves focus on the
           button. */
        onClick={(e) => (open ? close(false) : show(e.detail === 0 ? 0 : -1))}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={menu}
          id={menuId}
          className={`ui-dropdown-menu ui-dropdown-${align}`}
          role="menu"
          aria-label={label}
          style={menuStyle}
        >
          {items.map((item, i) => (
            <button
              key={`${i}-${item.label}`}
              type="button"
              role="menuitem"
              tabIndex={active === i ? 0 : -1}
              className={item.danger ? "ui-dropdown-item ui-dropdown-item-danger" : "ui-dropdown-item"}
              onClick={() => {
                item.onClick?.();
                if (!item.keepOpen) close(true);
              }}
            >
              {item.icon && (
                <span className="ui-dropdown-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}
              {item.strong ? <span style={{ fontWeight: "var(--cc-fw-strong)" }}>{item.label}</span> : item.label}
              {item.trailing}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
