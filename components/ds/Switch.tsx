"use client";

import React from "react";

/**
 * An on/off control. A real button with role="switch", so it is reachable by
 * Tab, toggled by Space or Enter, and announced as "on"/"off" -- which a
 * styled checkbox only manages when every call site remembers the label.
 */
export function Switch({
  checked,
  onChange,
  disabled,
  size = "md",
  "aria-label": ariaLabel,
  "aria-labelledby": labelledBy,
  id,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  "aria-label"?: string;
  "aria-labelledby"?: string;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={labelledBy}
      disabled={disabled}
      data-size={size}
      className="cc-switch-control"
      onClick={(e) => {
        /* Inside a <label> row the click would otherwise also fire on the
           label and toggle twice. */
        e.preventDefault();
        if (!disabled) onChange(!checked);
      }}
    >
      <span className="cc-switch-control__thumb" aria-hidden="true" />
    </button>
  );
}
