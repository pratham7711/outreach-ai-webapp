"use client";

import { useEffect, useState } from "react";
import { Modal } from "@pratham7711/ui";
import { toast } from "sonner";
import { Button, EntityPicker, type PickerOption } from "@/components/ds";
import { platformLabel, stripAt } from "@/lib/format";
import { creatorNameText } from "@/lib/creators/creatorName";

type Summary = {
  filled: string[];
  links: number;
  posts: number;
  activations: number;
  lists: number;
  tags: number;
  flags: number;
  payouts: number;
};

const FIELD_LABEL: Record<string, string> = {
  name: "name",
  contactEmail: "email",
  rate: "rate",
  boostRate: "boost rate",
  bio: "bio",
  paymentInfo: "payment details",
  notes: "notes",
  niches: "niches",
  trackedSince: "tracker watchlist",
  creatorUserId: "portal sign-in",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "7 posts, 1 campaign and 2 accounts", leaving out what is zero. */
function movedText(s: Summary): string {
  const parts = [
    s.posts && plural(s.posts, "post"),
    s.activations && plural(s.activations, "campaign"),
    s.links && plural(s.links, "account"),
    s.lists && plural(s.lists, "list"),
    s.tags && plural(s.tags, "tag"),
    s.flags && plural(s.flags, "flag"),
    s.payouts && plural(s.payouts, "payout"),
  ].filter(Boolean) as string[];
  if (!parts.length) return "Nothing else is attached to it.";
  const last = parts.pop();
  return `Moves ${parts.length ? `${parts.join(", ")} and ${last}` : last} onto this profile.`;
}

/**
 * Fold a duplicate of this creator into this profile. The duplicate is picked
 * by search, the move is previewed before anything changes, and this profile's
 * own name, handle and numbers are kept.
 */
export default function MergeCreatorModal({
  open,
  onClose,
  creator,
  onMerged,
}: {
  open: boolean;
  onClose: () => void;
  creator: { id: string; name: string; handle: string };
  onMerged: () => void;
}) {
  const [picked, setPicked] = useState<PickerOption | null>(null);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (!open) {
      setPicked(null);
      setPreview(null);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!picked) return;
    if (picked.id === creator.id) {
      setError("That's this creator. Pick the duplicate.");
      return;
    }
    let live = true;
    setLoading(true);
    fetch(`/api/creators/${creator.id}/merge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: picked.id, dryRun: true }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (res.status === 403) setError("Only admins and managers can merge creators.");
        else if (!res.ok) setError(data.error ?? "Couldn't check that creator. Try again.");
        else setPreview(data.summary);
      })
      .catch(() => live && setError("The request didn't go through. Nothing has changed."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [picked, creator.id]);

  const merge = async () => {
    if (!picked) return;
    setMerging(true);
    try {
      const res = await fetch(`/api/creators/${creator.id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: picked.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't merge them. Nothing has changed.");
        return;
      }
      toast.success(`Merged ${picked.label} into this profile.`);
      onClose();
      onMerged();
    } catch {
      setError("The request didn't go through. Nothing has changed.");
    } finally {
      setMerging(false);
    }
  };

  const name = creatorNameText(creator.name, creator.handle);
  const filled = preview?.filled.map((f) => FIELD_LABEL[f] ?? f) ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Merge a duplicate">
      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingBottom: 4 }}>
        <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text)", margin: 0 }}>
          Pick another profile of the same person. Its posts, campaigns, accounts and lists move onto {name}, which keeps its own name,
          handle and numbers.
        </p>
        <div>
          <label htmlFor="merge-creator" style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>
            Duplicate profile
          </label>
          <EntityPicker
            id="merge-creator"
            endpoint="/api/creators"
            placeholder="Search by name or handle…"
            extract={(json) =>
              json.creators
                .filter((c: any) => c.id !== creator.id)
                .map((c: any) => ({ id: c.id, label: c.name, hint: `@${stripAt(c.handle)} · ${platformLabel(c.platform)}` }))
            }
            value={picked}
            onChange={setPicked}
          />
        </div>
        {loading && <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>Checking what would move…</p>}
        {preview && picked && (
          <div aria-live="polite" style={{ border: "1px solid var(--cc-border)", borderRadius: 8, padding: 12, fontSize: "var(--cc-t-13)", color: "var(--cc-text)" }}>
            <p style={{ margin: 0 }}>{movedText(preview)}</p>
            {filled.length > 0 && <p style={{ margin: "6px 0 0" }}>Fills this profile&rsquo;s empty {filled.join(", ")} from it.</p>}
            <p style={{ margin: "6px 0 0", color: "var(--cc-text-muted)" }}>{picked.label} then leaves the roster. This can&rsquo;t be undone here.</p>
          </div>
        )}
        {error && (
          <p role="alert" style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-danger-ink)", margin: 0 }}>
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={merge} loading={merging} disabled={!preview || !!error}>
            Merge into this profile
          </Button>
        </div>
      </div>
    </Modal>
  );
}
