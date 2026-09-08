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

const LABEL: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  color: "var(--cc-text-muted)",
  marginBottom: 8,
  display: "block",
};

const FIELD: React.CSSProperties = {
  width: "100%",
  height: 36,
  padding: "0 10px",
  fontSize: 13,
  color: "var(--cc-text)",
  background: "var(--cc-card)",
  border: "1px solid var(--cc-border)",
  borderRadius: 8,
};

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
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(28, 32, 72, 0.32)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 160ms ease",
          zIndex: 60,
        }}
      />
      <aside
        role="dialog"
        aria-label="Filters"
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100dvh",
          width: "min(380px, 100vw)",
          background: "var(--cc-card)",
          borderLeft: "1px solid var(--cc-border)",
          boxShadow: "-8px 0 32px rgba(28, 32, 72, 0.12)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 200ms cubic-bezier(0.32, 0.72, 0, 1)",
          zIndex: 61,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px",
            borderBottom: "1px solid var(--cc-border)",
            flexShrink: 0,
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>
            <SlidersHorizontal size={16} /> Filters
          </span>
          <button
            onClick={onClose}
            aria-label="Close filters"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", padding: 4, display: "flex" }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 24 }}>
          {filters.map((def) => {
            if (def.type === "multiSelect") {
              const selected = (draft[def.key] ?? "").split(",").filter(Boolean);
              return (
                <div key={def.key}>
                  <span style={LABEL}>{def.label}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {def.options.map((opt) => {
                      const on = selected.includes(opt.value);
                      return (
                        <label
                          key={opt.value}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            padding: "7px 8px",
                            borderRadius: 8,
                            cursor: "pointer",
                            fontSize: 13,
                            color: "var(--cc-text)",
                            background: on ? "var(--cc-hover-bg)" : "transparent",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleInCsv(def.key, opt.value)}
                            style={{ display: "none" }}
                          />
                          <span
                            aria-hidden
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: 4,
                              border: `1.5px solid ${on ? "var(--cc-primary)" : "var(--cc-border)"}`,
                              background: on ? "var(--cc-primary)" : "transparent",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            {on && <Check size={11} color="white" strokeWidth={3} />}
                          </span>
                          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {opt.label}
                          </span>
                          {opt.count !== undefined && (
                            <span style={{ fontSize: 12, color: "var(--cc-text-muted)", flexShrink: 0 }}>{opt.count}</span>
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
                  <span style={LABEL}>{def.label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="date"
                      value={draft[def.fromKey] ?? ""}
                      onChange={(e) => set(def.fromKey, e.target.value)}
                      style={FIELD}
                      aria-label={`${def.label} from`}
                    />
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>to</span>
                    <input
                      type="date"
                      value={draft[def.toKey] ?? ""}
                      onChange={(e) => set(def.toKey, e.target.value)}
                      style={FIELD}
                      aria-label={`${def.label} to`}
                    />
                  </div>
                </div>
              );
            }

            if (def.type === "numberRange") {
              return (
                <div key={def.minKey}>
                  <span style={LABEL}>
                    {def.label}
                    {def.unit ? ` (${def.unit})` : ""}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder="Min"
                      value={draft[def.minKey] ?? ""}
                      onChange={(e) => set(def.minKey, e.target.value)}
                      style={FIELD}
                      aria-label={`Minimum ${def.label}`}
                    />
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>to</span>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      placeholder="Max"
                      value={draft[def.maxKey] ?? ""}
                      onChange={(e) => set(def.maxKey, e.target.value)}
                      style={FIELD}
                      aria-label={`Maximum ${def.label}`}
                    />
                  </div>
                </div>
              );
            }

            return (
              <div key={def.label}>
                <span style={LABEL}>{def.label}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {def.options.map((opt) => {
                    const on = draft[opt.key] === "1";
                    return (
                      <label
                        key={opt.key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "7px 8px",
                          borderRadius: 8,
                          cursor: "pointer",
                          fontSize: 13,
                          color: "var(--cc-text)",
                        }}
                      >
                        {opt.label}
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => set(opt.key, on ? undefined : "1")}
                          style={{ display: "none" }}
                        />
                        <span
                          aria-hidden
                          style={{
                            width: 34,
                            height: 20,
                            borderRadius: 999,
                            background: on ? "var(--cc-primary)" : "var(--cc-border)",
                            position: "relative",
                            transition: "background 140ms ease",
                            flexShrink: 0,
                          }}
                        >
                          <span
                            style={{
                              position: "absolute",
                              top: 2,
                              left: on ? 16 : 2,
                              width: 16,
                              height: 16,
                              borderRadius: "50%",
                              background: "white",
                              transition: "left 140ms ease",
                            }}
                          />
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <footer
          style={{
            display: "flex",
            gap: 8,
            padding: 16,
            borderTop: "1px solid var(--cc-border)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={clearAll}
            style={{
              flex: 1,
              height: 38,
              background: "var(--cc-card)",
              color: "var(--cc-text)",
              border: "1px solid var(--cc-border)",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Clear all
          </button>
          <button
            onClick={apply}
            style={{
              flex: 1,
              height: 38,
              background: "var(--cc-primary)",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
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
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 38,
        padding: "0 14px",
        background: "var(--cc-card)",
        color: count ? "var(--cc-primary)" : "var(--cc-text)",
        border: `1px solid ${count ? "var(--cc-primary)" : "var(--cc-border)"}`,
        borderRadius: 8,
        fontSize: 14,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <SlidersHorizontal size={15} />
      Filters
      {count > 0 && (
        <span
          style={{
            minWidth: 18,
            height: 18,
            padding: "0 5px",
            borderRadius: 999,
            background: "var(--cc-primary)",
            color: "white",
            fontSize: 11,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
