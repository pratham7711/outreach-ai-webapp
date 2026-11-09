"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { ModalNotice } from "@/components/ds/Modal";
import { Button } from "@/components/ds/Button";
import { apiFetch } from "@/lib/api/client";
import { isUnattributedCreator } from "@/lib/posts/unattributedName";
import { platformLabel } from "@/lib/platforms/registry";

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

/**
 * What a creator picker shows when the roster has nobody to pick: one way
 * forward instead of a search box over an empty list.
 */
export function EmptyRosterNotice() {
  return (
    <ModalNotice
      tone="neutral"
      icon={Users}
      title="No creators on your roster yet"
      action={
        <Link href="/creators" className="ui-btn ui-btn-secondary ui-btn-sm" data-cc-slot="secondary">
          Go to Creators
        </Link>
      }
    >
      Add them on the Creators page, then pick one here.
    </ModalNotice>
  );
}

export type PickableCreator = {
  id: string;
  name: string;
  handle: string;
  platform?: string;
  avatarUrl?: string | null;
};

/** "@handle · TikTok": the handle once, and the platform by its name. */
function creatorMeta(c: PickableCreator): string {
  const handle = c.handle.replace(/^@/, "");
  return [handle && `@${handle}`, c.platform && platformLabel(c.platform)].filter(Boolean).join(" · ");
}

export function CreatorSelect({
  value,
  onChange,
  excludeIds,
  placeholder = "Search creators by name or handle",
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  "aria-required": ariaRequired,
}: {
  value: string;
  onChange: (id: string, creator: PickableCreator | null) => void;
  /** Creators already used by the caller — shown as taken rather than hidden. */
  excludeIds?: Iterable<string>;
  placeholder?: string;
  /** On the search input, so a Field's label names and focuses it. */
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-required"?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<PickableCreator | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const taken = useMemo(() => new Set(excludeIds ?? []), [excludeIds]);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["creator-select", debounced],
    queryFn: () =>
      apiFetch<{ creators: PickableCreator[] }>(
        `/api/creators?limit=20${debounced ? `&search=${encodeURIComponent(debounced)}` : ""}`
      ),
  });
  /* The Unattributed holding row is on the roster but is nobody: picking it
     would file a post under "creator unknown" on purpose. */
  const results = (data?.creators ?? []).filter((c) => !isUnattributedCreator(c));

  // The caller owns the id; clearing it from outside has to clear the row too.
  useEffect(() => {
    if (!value) setPicked(null);
  }, [value]);

  /* The unsearched first page came back with nobody on it: the roster itself
     is empty, so there is nothing to search. */
  if (!debounced && data && results.length === 0) return <EmptyRosterNotice />;

  if (value && picked) {
    return (
      <div className="cc-creator-select__picked">
        <div className="cc-creator-select__text">
          <span className="cc-creator-select__name">{picked.name}</span>
          <span className="cc-creator-select__meta">{creatorMeta(picked)}</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          onClick={() => {
            setPicked(null);
            setSearch("");
            onChange("", null);
          }}
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="cc-creator-select">
      <input
        id={id}
        className="ui-input ui-input-md"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={placeholder}
        aria-label={id ? undefined : placeholder}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-required={ariaRequired || undefined}
        autoComplete="off"
      />
      <div className="cc-creator-select__list">
        {results.length === 0 ? (
          <p className="cc-creator-select__note">
            {isFetching
              ? "Searching…"
              : isError
                ? "Couldn't load creators. Try again."
                : "No creators match that."}
          </p>
        ) : (
          results.map((c) => {
            const already = taken.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                disabled={already}
                className="cc-creator-select__row"
                onClick={() => {
                  setPicked(c);
                  onChange(c.id, c);
                }}
              >
                <span className="cc-creator-select__text">
                  <span className="cc-creator-select__name">{c.name}</span>
                  <span className="cc-creator-select__meta">{creatorMeta(c)}</span>
                </span>
                {already && <span className="cc-creator-select__meta">Added</span>}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
