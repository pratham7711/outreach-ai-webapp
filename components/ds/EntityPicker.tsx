"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

/**
 * Pick one record out of a large table by searching for it.
 *
 * A native <select> has to be handed every option up front: the activations
 * form shipped 1,834 creators and 532 campaigns into the page payload — 185 KB
 * to render a board of 12 — and a 1,834-item dropdown was unusable anyway. This
 * asks the listing API instead, which already paginates and searches, so the
 * page carries nothing until someone types.
 */

export type PickerOption = { id: string; label: string; hint?: string };

export function EntityPicker({
  id,
  endpoint,
  extract,
  placeholder = "Search…",
  value,
  onChange,
}: {
  id: string;
  /** A listing route taking ?search= and ?limit=. */
  endpoint: string;
  /** Pulls the options out of that route's response shape. */
  extract: (json: any) => PickerOption[];
  placeholder?: string;
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

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
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (value) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 38,
          padding: "0 8px 0 12px",
          border: "1px solid var(--cc-border)",
          borderRadius: 8,
          background: "var(--cc-card)",
        }}
      >
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value.label}
        </span>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setQuery("");
          }}
          aria-label="Clear selection"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", display: "flex", padding: 2 }}
        >
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 38,
          padding: "0 12px",
          border: "1px solid var(--cc-border)",
          borderRadius: 8,
          background: "var(--cc-card)",
        }}
      >
        <Search size={15} color="var(--cc-text-muted)" />
        <input
          id={id}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            background: "transparent",
            fontSize: 14,
            color: "var(--cc-text)",
          }}
        />
      </div>

      {open && (
        <ul
          role="listbox"
          style={{
            position: "absolute",
            top: 42,
            left: 0,
            right: 0,
            zIndex: 10,
            maxHeight: 220,
            overflowY: "auto",
            margin: 0,
            padding: 4,
            listStyle: "none",
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 8,
            boxShadow: "0 8px 24px rgba(28, 32, 72, 0.12)",
          }}
        >
          {error ? (
            <li style={{ padding: "10px 12px", fontSize: 13, color: "var(--cc-danger)" }}>
              Could not load results. Try again.
            </li>
          ) : loading && options.length === 0 ? (
            <li style={{ padding: "10px 12px", fontSize: 13, color: "var(--cc-text-muted)" }}>Searching…</li>
          ) : options.length === 0 ? (
            <li style={{ padding: "10px 12px", fontSize: 13, color: "var(--cc-text-muted)" }}>No matches</li>
          ) : (
            options.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 10px",
                    border: "none",
                    borderRadius: 6,
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: 13,
                    color: "var(--cc-text)",
                  }}
                >
                  {opt.label}
                  {opt.hint && (
                    <span style={{ color: "var(--cc-text-muted)", marginLeft: 6 }}>{opt.hint}</span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
