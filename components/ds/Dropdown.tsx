"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { useAnchoredMenu } from "./useAnchoredMenu";

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
 *
 * The trigger is the app's one field box (.cc-dropdown__trigger in
 * globals.css): 36px, 8px corner, the field edge, the field focus halo. In a
 * form, wrap it in a Field and the label names and focuses it through `id`:
 *
 *   <Field label="Platform"><Dropdown fullWidth value={...} ... /></Field>
 */

export type DropdownOption = { value: string; label: string };

export function Dropdown({
  value,
  onChange,
  options,
  ariaLabel,
  id,
  align = "right",
  minWidth = 170,
  maxWidth,
  disabled = false,
  variant = "outlined",
  fullWidth = false,
  size = fullWidth ? "md" : "sm",
  placeholder,
  onOpen,
  triggerStyle,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  "aria-required": ariaRequired,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  /** The accessible name. Optional inside a Field, whose label names it. */
  ariaLabel?: string;
  /** Put on the trigger, so a <label htmlFor> focuses and names it. */
  id?: string;
  align?: "left" | "right";
  minWidth?: number;
  maxWidth?: number;
  disabled?: boolean;
  /** "primary" is the solid accent trigger the campaign rows use for status. */
  variant?: "outlined" | "primary";
  /**
   * Both are 36px. "sm" is the toolbar chip (13px, medium weight); "md" is a
   * form field (14px, regular) and is the default once `fullWidth` is set.
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
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value);
  const label = selected?.label ?? placeholder ?? options[0]?.label ?? "";

  const { pos } = useAnchoredMenu(open, triggerRef, menuRef, {
    align,
    minWidth,
    estimateHeight: Math.min(options.length * 34 + 8, 320),
  });

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));

    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, options, value]);

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
    if (e.key === "Escape") {
      if (!open) return;
      // Handled: a dialog around this select closes on the next Escape, not this one.
      e.preventDefault();
      return setOpen(false);
    }
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
          boxShadow: "var(--cc-popover-shadow)",
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
                  fontSize: "var(--cc-t-13)",
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
    <div className="cc-dropdown" data-full={fullWidth || undefined}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={ariaRequired || undefined}
        disabled={disabled}
        className="cc-dropdown__trigger"
        data-size={size}
        data-variant={variant}
        data-placeholder={selected ? undefined : ""}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) onOpen?.();
          onKeyDown(e);
        }}
        style={{
          minWidth: fullWidth ? undefined : minWidth,
          maxWidth,
          ...triggerStyle,
        }}
      >
        <span className="cc-dropdown__value">{label}</span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className="cc-dropdown__chevron"
          style={triggerStyle?.color ? { color: triggerStyle.color } : undefined}
        />
      </button>

      {typeof document !== "undefined" && menu ? createPortal(menu, document.body) : null}
    </div>
  );
}
