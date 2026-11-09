"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";
import { useAnchoredMenu } from "./useAnchoredMenu";

/**
 * A text field that also offers what already exists: type a new value, or pick
 * one from the list.
 *
 * It replaces `<input list>` + `<datalist>`. Chrome draws a datalist field as an
 * empty bar with a bare triangle and shows nothing until a character is typed,
 * so the Tag dialog asked people to remember their own tag names. Here the
 * list opens on a click, the chevron, ArrowDown or typing -- not on focus, so a
 * dialog that focuses the field on open stays calm -- and filters as you type.
 *
 * It wears the library input's own classes, so it is the same box as every
 * other field around it. The list is portalled and anchored (useAnchoredMenu),
 * so no dialog body can cut it off. Enter on a highlighted option picks it;
 * otherwise Enter belongs to the surrounding form. Escape closes the list
 * without closing the dialog.
 */
export function Combobox({
  label,
  value,
  onChange,
  options,
  placeholder,
  maxLength,
  autoFocus,
  maxShown = 50,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  maxLength?: number;
  autoFocus?: boolean;
  /** Cap on rows drawn; typing narrows the rest. */
  maxShown?: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputId = useId();
  const listId = useId();

  const needle = value.trim().toLowerCase();
  const matches = (needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options).slice(0, maxShown);
  const exact = needle !== "" && matches.length === 1 && matches[0].toLowerCase() === needle;
  const showList = open && matches.length > 0 && !exact;
  const { pos } = useAnchoredMenu(showList, wrapRef, listRef);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (!showList) return;
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
      } else if (matches.length) setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (showList) setActive((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (showList && active >= 0 && matches[active] && !e.nativeEvent.isComposing) {
        e.preventDefault();
        pick(matches[active]);
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const visible = showList && pos;
  const activeId = visible && active >= 0 && matches[active] ? `${listId}-${active}` : undefined;

  const list = visible ? (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={label}
      className="cc-entity-picker__list"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      {matches.map((o, i) => (
        <li
          key={o}
          id={`${listId}-${i}`}
          role="option"
          aria-selected={i === active}
          className="cc-entity-picker__option"
          data-active={i === active || undefined}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => setActive(i)}
          onClick={() => pick(o)}
        >
          {o}
        </li>
      ))}
    </ul>
  ) : null;

  return (
    <div className="ui-input-root">
      <label htmlFor={inputId} className="ui-input-label">
        {label}
      </label>
      <div ref={wrapRef} className="ui-input-wrap cc-combobox">
        <input
          id={inputId}
          className="ui-input ui-input-md ui-input-with-right"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={Boolean(visible)}
          aria-controls={visible ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
        />
        {options.length > 0 && (
          <button
            type="button"
            className="cc-combobox__toggle"
            tabIndex={-1}
            aria-label={open ? `Hide ${label.toLowerCase()} suggestions` : `Show ${label.toLowerCase()} suggestions`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen((o) => !o);
              document.getElementById(inputId)?.focus();
            }}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        )}
      </div>
      {typeof document !== "undefined" && list ? createPortal(list, document.body) : null}
    </div>
  );
}
