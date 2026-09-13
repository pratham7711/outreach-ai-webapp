"use client";

import { useEffect, useMemo, useState } from "react";
import { X, SlidersHorizontal, Check } from "lucide-react";

/**
 * The right-side filter panel for list pages, driven by a spec rather than
 * hand-written per page: a page declares which filters it has and the drawer
 * renders the right control for each type.
 *
 * Values are the raw query-string params, so what the drawer edits is exactly
 * what `lib/listFilters` parses on the server. Edits collect in a draft and
 * only reach the URL on Apply — a half-built date range should not refetch the
 * table on every keystroke.
 */

export type FilterOption = { value: string; label: string; count?: number };

export type FilterDef =
  /** Comma-joined values in one param. */
  | { type: "multiSelect"; key: string; label: string; options: FilterOption[] }
  /** Two params, either end optional. */
  | { type: "dateRange"; label: string; fromKey: string; toKey: string }
  | { type: "numberRange"; label: string; minKey: string; maxKey: string; unit?: string }
  /** Each option is its own param, present as "1" when on. */
  | { type: "toggleGroup"; label: string; options: Array<{ key: string; label: string }> };

export type FilterValues = Record<string, string | undefined>;

function keysOf(def: FilterDef): string[] {
  switch (def.type) {
    case "multiSelect":
      return [def.key];
    case "dateRange":
      return [def.fromKey, def.toKey];
    case "numberRange":
      return [def.minKey, def.maxKey];
    case "toggleGroup":
      return def.options.map((o) => o.key);
  }
}

export function FilterDrawer({
  open,
  onClose,
  filters,
  values,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  filters: FilterDef[];
  values: FilterValues;
  /** Receives every declared key, with undefined for the ones now cleared. */
  onApply: (next: FilterValues) => void;
}) {
  const [draft, setDraft] = useState<FilterValues>(values);

  // Reopening starts from what the URL actually says, discarding a cancelled edit.
  useEffect(() => {
    if (open) setDraft(values);
  }, [open, values]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const allKeys = useMemo(() => filters.flatMap(keysOf), [filters]);

  const set = (key: string, value: string | undefined) =>
    setDraft((d) => ({ ...d, [key]: value || undefined }));

  const toggleInCsv = (key: string, value: string) => {
    const current = (draft[key] ?? "").split(",").filter(Boolean);
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    set(key, next.join(","));
  };

  const apply = () => {
    const next: FilterValues = {};
    for (const key of allKeys) next[key] = draft[key];
    onApply(next);
    onClose();
  };

  const clearAll = () => {
    const cleared: FilterValues = {};
    for (const key of allKeys) cleared[key] = undefined;
    setDraft(cleared);
    onApply(cleared);
    onClose();
  };

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden
        className="cc-scrim cc-drawer-scrim"
        data-open={open}
      />
      <aside
        role="dialog"
        aria-label="Filters"
        aria-hidden={!open}
        className="cc-drawer"
        data-open={open}
      >
        <header className="cc-drawer-head">
          <span className="cc-drawer-title">
            <SlidersHorizontal size={16} /> Filters
          </span>
          <button
            onClick={onClose}
            aria-label="Close filters"
            className="cc-drawer-close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="cc-drawer-body">
          {filters.map((def) => {
            if (def.type === "multiSelect") {
              const selected = (draft[def.key] ?? "").split(",").filter(Boolean);
              return (
                <div key={def.key}>
                  <span className="cc-field-label">{def.label}</span>
                  <div className="cc-filter-list">
                    {def.options.map((opt) => {
                      const on = selected.includes(opt.value);
                      return (
                        <label key={opt.value} className="cc-filter-option" data-on={on}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleInCsv(def.key, opt.value)}
                            className="cc-visually-gone"
                          />
                          <span aria-hidden className="cc-checkbox" data-on={on}>
                            {on && <Check size={11} color="white" strokeWidth={3} />}
                          </span>
                          <span className="cc-filter-option-label">{opt.label}</span>
                          {opt.count !== undefined && (
                            <span className="cc-filter-option-count">{opt.count}</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            }

            if (def.type === "dateRange") {
              return (
                <div key={def.fromKey}>
                  <span className="cc-field-label">{def.label}</span>
                  <div className="cc-field-row">
                    <input
                      type="date"
                      value={draft[def.fromKey] ?? ""}
                      onChange={(e) => set(def.fromKey, e.target.value)}
                      className="cc-field"
                      aria-label={`${def.label} from`}
                    />
                    <span className="cc-field-sep">to</span>
                    <input
                      type="date"
                      value={draft[def.toKey] ?? ""}
                      onChange={(e) => set(def.toKey, e.target.value)}
                      className="cc-field"
                      aria-label={`${def.label} to`}
                    />
                  </div>
                </div>
              );
            }

            if (def.type === "numberRange") {
              return (
                <div key={def.minKey}>
                  <span className="cc-field-label">
                    {def.label}
                    {def.unit ? ` (${def.unit})` : ""}
                  </span>
                  <div className="cc-field-row">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder="Min"
                      value={draft[def.minKey] ?? ""}
                      onChange={(e) => set(def.minKey, e.target.value)}
                      className="cc-field"
                      aria-label={`Minimum ${def.label}`}
                    />
                    <span className="cc-field-sep">to</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder="Max"
                      value={draft[def.maxKey] ?? ""}
                      onChange={(e) => set(def.maxKey, e.target.value)}
                      className="cc-field"
                      aria-label={`Maximum ${def.label}`}
                    />
                  </div>
                </div>
              );
            }

            return (
              <div key={def.label}>
                <span className="cc-field-label">{def.label}</span>
                <div className="cc-filter-list">
                  {def.options.map((opt) => {
                    const on = draft[opt.key] === "1";
                    return (
                      <label key={opt.key} className="cc-filter-option" data-layout="split">
                        {opt.label}
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => set(opt.key, on ? undefined : "1")}
                          className="cc-visually-gone"
                        />
                        <span aria-hidden className="cc-switch" data-on={on}>
                          <span className="cc-switch-knob" />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <footer className="cc-drawer-foot">
          <button onClick={clearAll} className="cc-drawer-btn">
            Clear all
          </button>
          <button onClick={apply} className="cc-drawer-btn" data-variant="primary">
            Apply
          </button>
        </footer>
      </aside>
    </>
  );
}

/** The toolbar trigger, badged with how many filters are on. */
export function FilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="cc-filter-btn"
      data-active={count > 0}
    >
      <SlidersHorizontal size={15} />
      Filters
      {count > 0 && (
        <span className="cc-filter-btn-count">
          {count}
        </span>
      )}
    </button>
  );
}
