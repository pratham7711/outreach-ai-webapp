"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Dropdown } from "@/components/ds";

const PLATFORMS = [
  { key: "", label: "All platforms" },
  { key: "TIKTOK", label: "TikTok" },
  { key: "INSTAGRAM", label: "Instagram" },
  { key: "YOUTUBE", label: "YouTube" },
  { key: "TWITTER", label: "Twitter" },
];

const TYPES = [
  { key: "", label: "All types" },
  { key: "VIEW_BASED", label: "Pay per view" },
  { key: "BUDGET_BASED", label: "Fixed budget" },
  { key: "OPEN_COMMUNITY", label: "Open community" },
];

const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "rate", label: "Highest rate" },
  { key: "budget", label: "Budget remaining" },
];


export default function MarketplaceFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => {
    setQ(params.get("q") ?? "");
  }, [params]);

  const push = useCallback(
    (next: Record<string, string>) => {
      const usp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v) usp.set(k, v);
        else usp.delete(k);
      }
      usp.delete("page"); // reset pagination on any filter change
      router.push(`/explore?${usp.toString()}`);
    },
    [params, router]
  );

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        marginBottom: 24,
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          push({ q });
        }}
        style={{ flex: "1 1 240px", minWidth: 200 }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search campaigns or brands…"
          aria-label="Search campaigns"
          style={{
            width: "100%",
            height: 40,
            padding: "0 14px",
            borderRadius: 8,
            border: "1px solid var(--cc-border)",
            background: "var(--cc-card)",
            color: "var(--cc-text)",
            fontSize: 14,
            boxSizing: "border-box",
          }}
        />
      </form>

      <Dropdown
        ariaLabel="Platform"
        align="left"
        minWidth={140}
        value={params.get("platform") ?? ""}
        onChange={(v) => push({ platform: v })}
        options={PLATFORMS.map((p) => ({ value: p.key, label: p.label }))}
      />

      <Dropdown
        ariaLabel="Campaign type"
        align="left"
        minWidth={150}
        value={params.get("type") ?? ""}
        onChange={(v) => push({ type: v })}
        options={TYPES.map((t) => ({ value: t.key, label: t.label }))}
      />

      <Dropdown
        ariaLabel="Sort"
        align="left"
        minWidth={150}
        value={params.get("sort") ?? "newest"}
        onChange={(v) => push({ sort: v })}
        options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
      />
    </div>
  );
}
