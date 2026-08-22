"use client";

import { useEffect, useId, useRef, useState } from "react";
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
 * Kept to what a select does: one value, click or arrow to choose, Escape and
 * click-outside to dismiss, and the trigger keeps focus so the keyboard path
 * still works.
 */

export type DropdownOption = { value: string; label: string };

export function Dropdown({
  value,
  onChange,
  options,
  ariaLabel,
  align = "right",
  minWidth = 170,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  ariaLabel: string;
  align?: "left" | "right";
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, options, value]);

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
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
      choose(options[active].value);
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          minWidth,
          padding: "7px 12px",
          borderRadius: 8,
          fontSize: 13,
          fontWeight: 500,
          border: "1px solid var(--cc-border)",
          background: "var(--cc-card)",
          color: "var(--cc-text)",
          cursor: "pointer",
          outline: "none",
        }}
      >
        {selected?.label}
        <ChevronDown size={15} style={{ color: "var(--cc-text-muted)", flexShrink: 0 }} />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            [align]: 0,
            zIndex: 40,
            minWidth,
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
      )}
    </div>
  );
}
