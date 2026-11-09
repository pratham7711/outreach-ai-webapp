"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { X, SlidersHorizontal, Check } from "lucide-react";
import { Button } from "./Button";
import { Field } from "./Field";
import { Switch } from "./Switch";
import { FOCUSABLE, useDialogFocus } from "./useDialogFocus";

/**
 * The right-side filter panel for list pages, driven by a spec rather than
 * hand-written per page: a page declares which filters it has and the drawer
 * renders the right control for each type.
 *
 * Values are the raw query-string params, so what the drawer edits is exactly
 * what `lib/listFilters` parses on the server. Edits collect in a draft and
 * only reach the URL on Apply — a half-built date range should not refetch the
 * table on every keystroke.
 *
 * It is a modal layer like a dialog and shares the dialog's focus machinery
 * (useDialogFocus): focus moves to the first control on open, Tab stays in
 * the panel, Escape closes it only when it is the top layer, and focus goes
 * back to the Filters button on close. Apply waits for a change and Clear all
 * for something to clear.
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
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();

  // Reopening starts from what the URL actually says, discarding a cancelled edit.
  useEffect(() => {
    if (open) setDraft(values);
  }, [open, values]);

  const trapTab = useDialogFocus({
    open,
    panelRef,
    onClose,
    initialFocus: (panel) =>
      panel.querySelector<HTMLElement>("[autofocus],[data-autofocus]") ??
      panel.querySelector(".cc-drawer-body")?.querySelector<HTMLElement>(FOCUSABLE),
  });

  const allKeys = useMemo(() => filters.flatMap(keysOf), [filters]);
  const isSet = (v: FilterValues) => allKeys.some((k) => Boolean(v[k]));
  const changed = allKeys.some((k) => (draft[k] || undefined) !== (values[k] || undefined));
  const canClear = isSet(draft) || isSet(values);

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
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
        tabIndex={-1}
        className="cc-drawer"
        data-open={open}
        onKeyDown={trapTab}
      >
        <header className="cc-drawer-head">
          <h2 id={titleId} className="cc-drawer-title">
            <SlidersHorizontal size={16} aria-hidden="true" /> Filters
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="cc-drawer-close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="cc-drawer-body">
          {filters.map((def) => {
            if (def.type === "multiSelect") {
              const selected = (draft[def.key] ?? "").split(",").filter(Boolean);
              return (
                <Field key={def.key} label={def.label} group>
                  <div className="cc-filter-list">
                    {def.options.map((opt) => {
                      const on = selected.includes(opt.value);
                      return (
                        <label key={opt.value} className="cc-filter-option" data-on={on}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleInCsv(def.key, opt.value)}
                            className="sr-only"
                          />
                          <span aria-hidden className="cc-checkbox" data-on={on}>
                            {on && <Check size={11} strokeWidth={3} />}
                          </span>
                          <span className="cc-filter-option-label">{opt.label}</span>
                          {opt.count !== undefined && (
                            <span className="cc-filter-option-count">{opt.count}</span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </Field>
              );
            }

            if (def.type === "dateRange") {
              return (
                <Field key={def.fromKey} label={def.label} group>
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
                </Field>
              );
            }

            if (def.type === "numberRange") {
              return (
                <Field key={def.minKey} label={`${def.label}${def.unit ? ` (${def.unit})` : ""}`} group>
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
                </Field>
              );
            }

            return (
              <Field key={def.label} label={def.label} group>
                <div className="cc-filter-list">
                  {def.options.map((opt) => {
                    const on = draft[opt.key] === "1";
                    return (
                      <label key={opt.key} className="cc-filter-option" data-layout="split">
                        <span className="cc-filter-option-label">{opt.label}</span>
                        <Switch
                          checked={on}
                          aria-label={opt.label}
                          onChange={(next) => set(opt.key, next ? "1" : undefined)}
                        />
                      </label>
                    );
                  })}
                </div>
              </Field>
            );
          })}
        </div>

        <footer className="cc-drawer-foot">
          <Button variant="secondary" size="sm" disabled={!canClear} onClick={clearAll}>
            Clear all
          </Button>
          <Button variant="primary" size="sm" disabled={!changed} onClick={apply}>
            Apply
          </Button>
        </footer>
      </aside>
    </>
  );
}

/** The toolbar trigger, badged with how many filters are on. */
export function FilterButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cc-filter-btn"
      data-active={count > 0}
      aria-haspopup="dialog"
    >
      <SlidersHorizontal size={15} aria-hidden="true" />
      Filters
      {count > 0 && (
        <span className="cc-filter-btn-count">
          {count}
        </span>
      )}
    </button>
  );
}

type ActiveChip = { id: string; label: string; keys: string[] };

function chipsOf(filters: FilterDef[], values: FilterValues): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const def of filters) {
    switch (def.type) {
      case "multiSelect": {
        const picked = (values[def.key] ?? "").split(",").filter(Boolean);
        if (!picked.length) break;
        const names = picked.map((v) => def.options.find((o) => o.value === v)?.label ?? v);
        const shown = names.length > 2 ? `${names[0]} +${names.length - 1}` : names.join(", ");
        chips.push({ id: def.key, label: `${def.label}: ${shown}`, keys: [def.key] });
        break;
      }
      case "dateRange": {
        const from = values[def.fromKey];
        const to = values[def.toKey];
        if (!from && !to) break;
        const span = from && to ? `${from} – ${to}` : from ? `from ${from}` : `until ${to}`;
        chips.push({ id: def.fromKey, label: `${def.label}: ${span}`, keys: [def.fromKey, def.toKey] });
        break;
      }
      case "numberRange": {
        const min = values[def.minKey];
        const max = values[def.maxKey];
        if (!min && !max) break;
        const unit = def.unit ? ` ${def.unit}` : "";
        const span = min && max ? `${min}–${max}${unit}` : min ? `≥ ${min}${unit}` : `≤ ${max}${unit}`;
        chips.push({ id: def.minKey, label: `${def.label}: ${span}`, keys: [def.minKey, def.maxKey] });
        break;
      }
      case "toggleGroup":
        for (const o of def.options) {
          if (values[o.key] === "1") chips.push({ id: o.key, label: o.label, keys: [o.key] });
        }
        break;
    }
  }
  return chips;
}

export function ActiveFilterChips({
  filters,
  values,
  onClear,
}: {
  filters: FilterDef[];
  values: FilterValues;
  /** The params to drop: every key behind the removed chip, or all of them. */
  onClear: (keys: string[]) => void;
}) {
  const chips = chipsOf(filters, values);
  if (!chips.length) return null;
  return (
    <div className="cc-filter-chips" role="group" aria-label="Active filters">
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          className="cc-filter-chip"
          aria-label={`Remove filter ${c.label}`}
          onClick={() => onClear(c.keys)}
        >
          <span className="cc-filter-chip-label">{c.label}</span>
          <X size={13} aria-hidden="true" />
        </button>
      ))}
      {chips.length > 1 && (
        <button type="button" className="cc-filter-chips-clear" onClick={() => onClear(chips.flatMap((c) => c.keys))}>
          Clear all
        </button>
      )}
    </div>
  );
}
