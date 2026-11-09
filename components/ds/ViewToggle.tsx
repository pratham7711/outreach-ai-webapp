"use client";

import { useRef, type KeyboardEvent } from "react";
import type { LucideIcon } from "lucide-react";

export type ViewOption<V extends string> = { value: V; label: string; icon: LucideIcon };

/**
 * Grid / table (or any two or three views of one list), as one framed segment.
 *
 * Creators drew this as two library buttons with a solid black "on" state and
 * the posts tab as a hand-built 28px segment with square corners. Here it is a
 * radio group: one stop in the tab order, arrows move between views, and the
 * selected one is the ink tint the rest of the app uses for "current".
 */
export function ViewToggle<V extends string>({
  value,
  onChange,
  options,
  ariaLabel = "View",
}: {
  value: V;
  onChange: (value: V) => void;
  options: ViewOption<V>[];
  ariaLabel?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="cc-view-toggle">
      {options.map((o, i) => {
        const checked = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.label}
            title={o.label}
            tabIndex={checked ? 0 : -1}
            className="cc-view-toggle-btn"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
