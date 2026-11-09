"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { useAnchoredMenu } from "./useAnchoredMenu";

/**
 * Pick one record out of a large table by searching for it.
 *
 * A native <select> has to be handed every option up front: the activations
 * form shipped 1,834 creators and 532 campaigns into the page payload — 185 KB
 * to render a board of 12 — and a 1,834-item dropdown was unusable anyway. This
 * asks the listing API instead, which already paginates and searches, so the
 * page carries nothing until someone types.
 *
 * The results open on a click, a keystroke or ArrowDown -- not on focus, so a
 * dialog that focuses this field on open does not throw a list over its own
 * footer. They are portalled and anchored to the field (useAnchoredMenu): in
 * the Merge dialog an in-flow list was cut off by the dialog body at its footer.
 * Being outside the dialog, the options are reached with the arrow keys
 * (aria-activedescendant) rather than Tab, and Escape closes the list
 * without closing the dialog.
 */

export type PickerOption = { id: string; label: string; hint?: string };

export function EntityPicker({
  id,
  endpoint,
  extract,
  placeholder = "Search…",
  value,
  onChange,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  "aria-required": ariaRequired,
}: {
  /** On the search input; a Field passes its own. */
  id: string;
  /** A listing route taking ?search= and ?limit=. */
  endpoint: string;
  /** Pulls the options out of that route's response shape. */
  extract: (json: any) => PickerOption[];
  placeholder?: string;
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const { pos } = useAnchoredMenu(open, fieldRef, listRef);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const timer = setTimeout(async () => {
      try {
        const url = `${endpoint}?limit=20${query ? `&search=${encodeURIComponent(query)}` : ""}`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        setOptions(extract(await res.json()));
        setActive(-1);
      } catch (err) {
        // An aborted request is the next keystroke, not a failure.
        if ((err as Error).name !== "AbortError") setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, open, endpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (fieldRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, listId]);

  const pick = (opt: PickerOption) => {
    onChange(opt);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (!open) return;
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (options.length) setActive((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open && options.length) setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && options[active]) {
        e.preventDefault();
        pick(options[active]);
      }
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  if (value) {
    return (
      <div className="cc-entity-picker__field" data-picked="">
        <span className="cc-entity-picker__value">{value.label}</span>
        <button
          type="button"
          className="cc-entity-picker__clear"
          onClick={() => {
            onChange(null);
            setQuery("");
          }}
          aria-label="Clear selection"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    );
  }

  const showList = open && pos;
  const activeId = showList && active >= 0 && options[active] ? `${listId}-${active}` : undefined;

  const list = showList ? (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      aria-label={placeholder}
      className="cc-entity-picker__list"
      style={{ top: pos.top, left: pos.left, width: pos.width }}
    >
      {error ? (
        <li className="cc-entity-picker__note" data-tone="danger">
          Could not load results. Try again.
        </li>
      ) : loading && options.length === 0 ? (
        <li className="cc-entity-picker__note">Searching…</li>
      ) : options.length === 0 ? (
        <li className="cc-entity-picker__note">No matches</li>
      ) : (
        options.map((opt, i) => (
          <li
            key={opt.id}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className="cc-entity-picker__option"
            data-active={i === active || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(opt)}
          >
            {opt.label}
            {opt.hint && <span className="cc-entity-picker__hint">{opt.hint}</span>}
          </li>
        ))
      )}
    </ul>
  ) : null;

  return (
    <>
      <div ref={fieldRef} className="cc-entity-picker__field">
        <Search size={15} className="cc-entity-picker__icon" aria-hidden="true" />
        <input
          id={id}
          className="cc-entity-picker__input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={Boolean(showList)}
          aria-controls={showList ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          aria-required={ariaRequired || undefined}
          autoComplete="off"
        />
      </div>
      {typeof document !== "undefined" && list ? createPortal(list, document.body) : null}
    </>
  );
}
