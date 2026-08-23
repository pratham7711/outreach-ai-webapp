"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

/**
 * A select that the app actually draws.
 *
 * A native <select> hands its option list to the operating system, and on macOS
 * Chrome that menu is drawn at the system's own size and font — it ignores the
 * control's 13px, so the popup opened at roughly twice the size of everything
 * around it and spilled over the cards behind it. No CSS reaches inside a
 * native popup, so the only fix is to stop opening one.
 *
 * The menu is portalled to <body> and positioned with fixed coordinates taken
 * off the trigger, rather than absolutely inside a relative wrapper. That is
 * not tidiness: `.cc-card` sets `overflow: hidden`, so an in-flow menu on a
 * campaign row — the row IS a card — was clipped to the row's own height and
 * only the first option or two survived. Anything in a table cell, a modal or a
 * scroll container had the same problem. Portalling is what makes one component
 * safe to use in all of them.
 *
 * Kept to what a select does: one value, click or arrow to choose, Escape and
 * click-outside to dismiss, and the trigger keeps focus so the keyboard path
 * still works.
 */

export type DropdownOption = { value: string; label: string };

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;

export function Dropdown({
  value,
  onChange,
  options,
  ariaLabel,
  align = "right",
  minWidth = 170,
  maxWidth,
  disabled = false,
  variant = "outlined",
  size = "sm",
  fullWidth = false,
  placeholder,
  onOpen,
  triggerStyle,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  ariaLabel: string;
  align?: "left" | "right";
  minWidth?: number;
  maxWidth?: number;
  disabled?: boolean;
  /** "primary" is the solid accent trigger the campaign rows use for status. */
  variant?: "outlined" | "primary";
  /**
   * "sm" is the filter chip. "md" matches the text inputs in our forms -- same
   * 10px/14px box, 10px corner and 14px type -- so a converted form select sits
   * flush with the fields around it instead of shrinking next to them.
   */
  size?: "sm" | "md";
  /** Form fields want the trigger to fill its column, like the input beside it. */
  fullWidth?: boolean;
  /** Shown when nothing matches `value` — the empty option of a form select. */
  placeholder?: string;
  /**
   * Fired as the menu opens. Some of these selects used onFocus to fetch their
   * own options; that has to happen before the list is drawn, not on change.
   */
  onOpen?: () => void;
  /**
   * Last-word overrides for the trigger. One surface needs it: the admin
   * feature-access bar, where the control sits on the accent header and its
   * select was translucent white on white text. Neither variant covers that,
   * and a third variant for a single instance is not worth the API.
   */
  triggerStyle?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder ?? options[0]?.label ?? "";
  const isPrimary = variant === "primary";
  const md = size === "md";

  /* Measured off the trigger every time it could have moved, so a menu opened
     inside a scrolling list stays attached to its own control. */
  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    const menuH = menuRef.current?.offsetHeight ?? Math.min(options.length * 34 + 8, 320);
    const width = Math.max(r.width, minWidth);

    const below = window.innerHeight - r.bottom - VIEWPORT_MARGIN;
    const flip = below < menuH && r.top > below;
    const top = flip ? r.top - menuH - MENU_GAP : r.bottom + MENU_GAP;

    // Right-aligned menus hang off the trigger's right edge; either way the
    // menu is then pulled back inside the viewport rather than off-screen.
    let left = align === "right" ? r.right - width : r.left;
    left = Math.min(left, window.innerWidth - width - VIEWPORT_MARGIN);
    left = Math.max(VIEWPORT_MARGIN, left);

    setPos({ top: Math.max(VIEWPORT_MARGIN, top), left, width });
  }, [align, minWidth, options.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));

    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    // Capture, so a scroll inside any ancestor container repositions the menu
    // instead of leaving it stranded where the trigger used to be.
    const onMove = () => place();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, options, value, place]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Escape") return setOpen(false);
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      return setOpen(true);
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (options[active]) choose(options[active].value);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const menu =
    open && pos ? (
      <ul
        ref={menuRef}
        id={listId}
        role="listbox"
        aria-label={ariaLabel}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          minWidth: pos.width,
          zIndex: 1000,
          maxHeight: 320,
          overflowY: "auto",
          margin: 0,
          padding: 4,
          listStyle: "none",
          borderRadius: 10,
          border: "1px solid var(--cc-border)",
          background: "var(--cc-card)",
          boxShadow: "0 8px 24px rgba(28, 32, 72, 0.12)",
        }}
      >
        {options.map((o, i) => {
          const isSelected = o.value === selected?.value;
          return (
            <li key={o.value} role="option" aria-selected={isSelected}>
              <button
                type="button"
                onClick={() => choose(o.value)}
                onMouseEnter={() => setActive(i)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 10px",
                  borderRadius: 6,
                  border: "none",
                  fontSize: 13,
                  fontWeight: isSelected ? 600 : 400,
                  color: "var(--cc-text)",
                  background: i === active ? "var(--cc-bg)" : "transparent",
                  cursor: "pointer",
                }}
              >
                <Check
                  size={14}
                  style={{ color: "var(--cc-primary)", opacity: isSelected ? 1 : 0, flexShrink: 0 }}
                />
                {o.label}
              </button>
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <div
      style={{
        position: "relative",
        display: fullWidth ? "block" : "inline-block",
        width: fullWidth ? "100%" : undefined,
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) onOpen?.();
          onKeyDown(e);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: fullWidth ? "100%" : undefined,
          minWidth: fullWidth ? undefined : minWidth,
          maxWidth,
          padding: md ? "10px 14px" : "7px 12px",
          borderRadius: md ? 10 : 8,
          fontSize: md ? 14 : 13,
          fontWeight: isPrimary ? 600 : md ? 400 : 500,
          border: isPrimary ? "none" : "1px solid var(--cc-border)",
          background: isPrimary ? "var(--cc-primary)" : "var(--cc-card)",
          color: isPrimary ? "#fff" : selected ? "var(--cc-text)" : "var(--cc-text-muted)",
          cursor: disabled ? "progress" : "pointer",
          opacity: disabled ? 0.65 : 1,
          outline: "none",
          ...triggerStyle,
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        <ChevronDown
          size={15}
          style={{
            color: triggerStyle?.color ?? (isPrimary ? "#fff" : "var(--cc-text-muted)"),
            flexShrink: 0,
          }}
        />
      </button>

      {typeof document !== "undefined" && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
