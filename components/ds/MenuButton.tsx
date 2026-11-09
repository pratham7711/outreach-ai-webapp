"use client";

import { Fragment, useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useAnchoredMenu } from "./useAnchoredMenu";

/**
 * A button that opens a menu of actions: the account menu, the bell, and the
 * ⋯ overflow (MoreMenu) that holds a row's less-used and destructive actions.
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
  /** A download or a link, drawn as an <a> so the browser does the saving. */
  href?: string;
  download?: boolean;
  /** Shown but not runnable, e.g. while the same action is in flight. Stays
   *  focusable, as a disabled menu item should, so it is still announced. */
  disabled?: boolean;
  /** Draw a rule above this item, to start a new group. A danger item that
   *  follows a safe one gets the rule without asking. */
  startsGroup?: boolean;
};

export function MenuButton({
  trigger,
  items,
  label,
  align = "left",
  onOpen,
  menuStyle,
  triggerClassName = "cc-menu-button",
  triggerTitle,
  portal = false,
}: {
  trigger: ReactNode;
  items: MenuButtonItem[];
  /** The button's accessible name, also given to the menu. */
  label: string;
  align?: "left" | "right";
  onOpen?: () => void;
  /** Extra style for the open menu, e.g. a max height for a long list. */
  menuStyle?: CSSProperties;
  /** The trigger's look. The default is a bare reset for the bell and avatar;
   *  MoreMenu passes the library's button classes. */
  triggerClassName?: string;
  /** Hover text for an icon-only trigger. */
  triggerTitle?: string;
  /** Draw the menu on <body>, anchored to the button, so no card, table or
   *  stacking context around the button can cut it off or paint over it.
   *  MoreMenu sets it; the top bar's two menus do not need it. */
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const { pos } = useAnchoredMenu(portal && open, button, menu, { align, fitContent: true });

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
      const target = e.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) close(false);
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

  // A portalled menu is hidden until it has been placed, and a hidden item
  // cannot take focus, so the keyboard's first item waits for the placement.
  const ready = !portal || pos !== null;
  useEffect(() => {
    if (!open || active < 0 || !ready) return;
    menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus();
  }, [open, active, ready]);

  const portalled = (node: ReactNode) =>
    portal && typeof document !== "undefined" ? createPortal(node, document.body) : node;

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
      // A portalled menu sits at the end of <body>, so Tab from it would leave
      // the page; handing focus back to the button first lets Tab carry on
      // from where the menu was opened.
      close(portal);
    }
  };

  return (
    <div ref={root} className="ui-dropdown" onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={`ui-dropdown-trigger ${triggerClassName}`}
        title={triggerTitle}
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
      {open && portalled(
        <div
          ref={menu}
          id={menuId}
          className={portal ? "ui-dropdown-menu cc-menu-portal" : `ui-dropdown-menu ui-dropdown-${align}`}
          role="menu"
          aria-label={label}
          style={
            portal
              ? { ...menuStyle, top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? undefined : "hidden" }
              : menuStyle
          }
        >
          {items.map((item, i) => {
            const rule = i > 0 && (item.startsGroup || (item.danger && !items[i - 1].danger));
            const className = item.danger ? "ui-dropdown-item ui-dropdown-item-danger" : "ui-dropdown-item";
            const body = (
              <>
                {item.icon && (
                  <span className="ui-dropdown-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                )}
                {item.strong ? <span style={{ fontWeight: "var(--cc-fw-strong)" }}>{item.label}</span> : item.label}
                {item.trailing}
              </>
            );
            const run = () => {
              if (item.disabled) return;
              item.onClick?.();
              if (!item.keepOpen) close(true);
            };
            return (
              <Fragment key={`${i}-${item.label}`}>
                {rule && <div role="separator" className="cc-menu-sep" />}
                {item.href && !item.disabled ? (
                  <a
                    role="menuitem"
                    tabIndex={active === i ? 0 : -1}
                    className={className}
                    href={item.href}
                    download={item.download}
                    onClick={run}
                  >
                    {body}
                  </a>
                ) : (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={active === i ? 0 : -1}
                    className={className}
                    aria-disabled={item.disabled || undefined}
                    onClick={run}
                  >
                    {body}
                  </button>
                )}
              </Fragment>
            );
          })}
        </div>,
      )}
    </div>
  );
}
