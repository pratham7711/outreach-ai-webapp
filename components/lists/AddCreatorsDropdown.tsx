"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ds";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { platformLabel, stripAt } from "@/lib/format";

type Option = { id: string; name: string; handle: string; platform: string };

const PAGE_SIZE = 25;

/**
 * Put many creators on a list at once.
 *
 * A dropdown of checkboxes over the roster, searched on the server -- the
 * roster runs to thousands, so filtering the first page in the browser would
 * make most creators look missing. Ticks survive a new search, so a list can
 * be built from several queries and saved in one request.
 */
export default function AddCreatorsDropdown({
  listId,
  onList,
  onAdded,
}: {
  listId: string;
  /** Creator ids already on the list: shown ticked and locked. */
  onList: string[];
  onAdded: (added: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [picked, setPicked] = useState<Record<string, Option>>({});
  const [saving, setSaving] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const already = useMemo(() => new Set(onList), [onList]);
  const pickedIds = Object.keys(picked);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), page: String(page) });
        if (query.trim()) params.set("search", query.trim());
        const res = await fetch(`/api/creators?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = await res.json();
        const rows: Option[] = (json.creators ?? []).map((c: Option) => ({
          id: c.id,
          name: c.name,
          handle: c.handle,
          platform: c.platform,
        }));
        setOptions((prev) => (page === 1 ? rows : [...prev, ...rows]));
        setTotal(json.pagination?.total ?? rows.length);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, page === 1 ? 250 : 0);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, query, page]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
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

  const selectable = options.filter((o) => !already.has(o.id));
  const allShownPicked = selectable.length > 0 && selectable.every((o) => picked[o.id]);

  function toggle(option: Option) {
    setPicked((prev) => {
      if (!prev[option.id]) return { ...prev, [option.id]: option };
      const next = { ...prev };
      delete next[option.id];
      return next;
    });
  }

  function toggleAllShown() {
    setPicked((prev) => {
      const next = { ...prev };
      if (allShownPicked) for (const o of selectable) delete next[o.id];
      else for (const o of selectable) next[o.id] = o;
      return next;
    });
  }

  async function save() {
    if (!pickedIds.length || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/lists/${listId}/creators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorIds: pickedIds }),
      });
      if (!res.ok) {
        toast.error("Could not add creators");
        return;
      }
      const { added = pickedIds.length } = await res.json().catch(() => ({}));
      toast.success(`Added ${added} creator${added === 1 ? "" : "s"}`);
      setPicked({});
      setOpen(false);
      onAdded(added);
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={boxRef} className="cc-add-creators" style={{ position: "relative" }}>
      <Button
        variant="primary"
        size="sm"
        iconRight={<Plus size={14} />}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        Add Creators
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Add creators to this list"
          className="cc-add-creators-panel"
          style={{
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 12,
            boxShadow: "var(--cc-popover-shadow)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 10, borderBottom: "1px solid var(--cc-border)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 36,
                padding: "0 10px",
                border: "1px solid var(--cc-border)",
                borderRadius: 8,
                background: "var(--cc-bg)",
              }}
            >
              <Search size={15} color="var(--cc-text-muted)" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search creators…"
                aria-label="Search creators"
                style={{ flex: 1, minWidth: 0, border: "none", background: "transparent", fontSize: "var(--cc-t-14)", color: "var(--cc-text)", outline: "none" }}
              />
            </div>
            {selectable.length > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", cursor: "pointer" }}>
                <input type="checkbox" checked={allShownPicked} onChange={toggleAllShown} style={{ accentColor: "var(--cc-primary)" }} />
                Select all shown ({selectable.length})
              </label>
            )}
          </div>

          <ul role="listbox" aria-multiselectable="true" style={{ listStyle: "none", margin: 0, padding: 4, maxHeight: 320, minHeight: 0, flex: "1 1 auto", overflowY: "auto" }}>
            {options.map((o) => {
              const locked = already.has(o.id);
              const checked = locked || Boolean(picked[o.id]);
              return (
                <li key={o.id} role="option" aria-selected={checked} aria-disabled={locked}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 8px",
                      borderRadius: 8,
                      cursor: locked ? "default" : "pointer",
                      opacity: locked ? 0.6 : 1,
                      background: picked[o.id] ? "var(--cc-primary-light)" : undefined,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={locked}
                      onChange={() => toggle(o)}
                      style={{ accentColor: "var(--cc-primary)", flexShrink: 0 }}
                    />
                    <CreatorAvatar id={o.id} name={o.name} size="sm" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span title={o.name} style={{ display: "block", fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {o.name}
                      </span>
                      <span style={{ display: "block", fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        @{stripAt(o.handle)} · {platformLabel(o.platform)}
                      </span>
                    </span>
                    {locked && <span style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-muted)", flexShrink: 0 }}>On list</span>}
                  </label>
                </li>
              );
            })}
            {loading && <li style={{ padding: 12, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>Loading…</li>}
            {!loading && error && <li style={{ padding: 12, fontSize: "var(--cc-t-13)", color: "var(--cc-danger)" }}>Could not load creators.</li>}
            {!loading && !error && options.length === 0 && (
              <li style={{ padding: 12, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>No creators match.</li>
            )}
            {!loading && !error && options.length < total && (
              <li>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  style={{ width: "100%", padding: 10, background: "none", border: "none", cursor: "pointer", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-primary)" }}
                >
                  Show more ({total - options.length} left)
                </button>
              </li>
            )}
          </ul>

          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 10, borderTop: "1px solid var(--cc-border)" }}>
            <span style={{ flex: 1, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
              {pickedIds.length} selected
            </span>
            {pickedIds.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setPicked({})}>
                Clear
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={save} disabled={!pickedIds.length || saving}>
              {saving ? "Adding…" : pickedIds.length ? `Add ${pickedIds.length} to list` : "Add to list"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
