"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";

/**
 * Pick one creator out of the whole roster.
 *
 * Every creator picker on the campaign page used to be a <select> fed by a bare
 * `fetch("/api/creators")`. That endpoint pages, and its default limit is 20 —
 * so all of them offered the first 20 of 1,834 creators and silently hid the
 * rest. The Add Creator modal even said "All creators are already assigned"
 * once those 20 were on the campaign, which was a confident falsehood about
 * 1,814 creators it had never asked for.
 *
 * The fix is to search on the server instead of paging blindly on the client,
 * which is also what the reference does. The list only ever shows what the
 * query actually returned, and says so when nothing matches.
 */

export type PickableCreator = {
  id: string;
  name: string;
  handle: string;
  platform?: string;
  avatarUrl?: string | null;
};

export function CreatorSelect({
  value,
  onChange,
  excludeIds,
  placeholder = "Search creators by name or handle",
  emptyHint,
}: {
  value: string;
  onChange: (id: string, creator: PickableCreator | null) => void;
  /** Creators already used by the caller — shown as taken rather than hidden. */
  excludeIds?: Iterable<string>;
  placeholder?: string;
  /** Shown before anything is typed, when the unsearched first page is empty. */
  emptyHint?: string;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<PickableCreator | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const taken = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);

  const { data, isFetching } = useQuery({
    queryKey: ["creator-select", debounced],
    queryFn: () =>
      apiFetch<{ creators: PickableCreator[] }>(
        `/api/creators?limit=20${debounced ? `&search=${encodeURIComponent(debounced)}` : ""}`
      ),
  });
  const results = data?.creators ?? [];

  // The caller owns the id; clearing it from outside has to clear the row too.
  useEffect(() => {
    if (!value) setPicked(null);
  }, [value]);

  if (value && picked) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--cc-primary)",
          background: "var(--cc-card)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{picked.name}</div>
          <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
            @{picked.handle.replace(/^@/, "")}
            {picked.platform ? ` — ${picked.platform}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setPicked(null);
            setSearch("");
            onChange("", null);
          }}
          style={{
            border: "1px solid var(--cc-border)",
            background: "var(--cc-card)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 12,
            color: "var(--cc-text-muted)",
            cursor: "pointer",
          }}
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        style={{
          width: "100%",
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid var(--cc-border)",
          fontSize: 14,
          color: "var(--cc-text)",
          background: "var(--cc-card)",
        }}
      />
      <div
        style={{
          marginTop: 8,
          maxHeight: 240,
          overflowY: "auto",
          border: "1px solid var(--cc-border)",
          borderRadius: 8,
        }}
      >
        {results.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", padding: "12px" }}>
            {isFetching
              ? "Searching…"
              : debounced
                ? "No creators match that."
                : (emptyHint ?? "No creators yet.")}
          </p>
        ) : (
          results.map((c) => {
            const already = taken.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={already}
                onClick={() => {
                  setPicked(c);
                  onChange(c.id, c);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  border: "none",
                  borderBottom: "1px solid var(--cc-border)",
                  background: "transparent",
                  cursor: already ? "not-allowed" : "pointer",
                  opacity: already ? 0.5 : 1,
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--cc-text)",
                    }}
                  >
                    {c.name}
                  </span>
                  <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)" }}>
                    @{c.handle.replace(/^@/, "")}
                    {c.platform ? ` — ${c.platform}` : ""}
                  </span>
                </span>
                {already && (
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Added</span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
