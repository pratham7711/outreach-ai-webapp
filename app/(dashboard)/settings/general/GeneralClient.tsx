"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { Input } from "@pratham7711/ui";
import { PageHeader, SectionCard, Dropdown, useConfirm, Button } from "@/components/ds";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";

/**
 * Settings → General, mirroring the reference's Tags & Statuses page.
 *
 * The reference keeps six lists here, and they differ only in the extra column
 * each row carries -- a flag has an emoji, a deliverable type a platform, a
 * status a bucket. So this is one list component rendered six times rather than
 * six near-identical ones, matching the single API route behind it.
 *
 * Campaign statuses are the one list that groups. The reference shows them under
 * four fixed headings (Pending, Active, Complete, Canceled) with the org's own
 * named statuses inside, which is exactly our CampaignStatus enum with a name
 * hanging off it -- so the grouping here is the enum, not a second concept.
 */

type Item = {
  id: string;
  name: string;
  sortOrder: number;
  emoji?: string | null;
  platform?: string | null;
  bucket?: string | null;
};

type Kind =
  | "creator-tags"
  | "creator-flags"
  | "campaign-tags"
  | "deliverable-types"
  | "campaign-statuses"
  | "activation-statuses";

/** The reference's four group headings, in its order. */
const CAMPAIGN_BUCKETS: { value: string; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "Active" },
  { value: "COMPLETE", label: "Complete" },
  { value: "CANCELLED", label: "Canceled" },
];

const ACTIVATION_BUCKETS: { value: string; label: string }[] = [
  { value: "AWAITING_DRAFT", label: "Awaiting draft" },
  { value: "DRAFT_SUBMITTED", label: "Draft submitted" },
  { value: "AWAITING_APPROVAL", label: "Awaiting approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "POSTING", label: "Posting" },
  { value: "POSTED", label: "Posted" },
  { value: "COMPLETE", label: "Complete" },
  { value: "DECLINED", label: "Declined" },
];

const PLATFORMS = [
  "INSTAGRAM", "TIKTOK", "YOUTUBE", "TWITTER", "FACEBOOK",
  "TWITCH", "THREADS", "PINTEREST", "SNAPCHAT", "LINKEDIN",
];

function bucketsFor(kind: Kind) {
  if (kind === "campaign-statuses") return CAMPAIGN_BUCKETS;
  if (kind === "activation-statuses") return ACTIVATION_BUCKETS;
  return null;
}

function TaxonomyList({
  kind,
  title,
  description,
  addLabel,
  emptyLabel,
  canManage,
}: {
  kind: Kind;
  title: string;
  description: string;
  addLabel: string;
  emptyLabel: string;
  /** Editing these lists needs `settings:*`; reading them does not, because
      every picker in the product is fed from here. Without this the add,
      rename and remove controls were offered to everyone and answered 403. */
  canManage: boolean;
}) {
  const confirm = useConfirm();
  const buckets = bucketsFor(kind);
  const hasEmoji = kind === "creator-flags";
  const hasPlatform = kind === "deliverable-types";

  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftEmoji, setDraftEmoji] = useState("");
  const [draftBucket, setDraftBucket] = useState(buckets?.[0]?.value ?? "");
  const [draftPlatform, setDraftPlatform] = useState("");

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/settings/taxonomy/${kind}`);
      if (!res.ok) throw new Error(`Could not load (${res.status})`);
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this list");
      setItems([]);
    }
  }, [kind]);

  useEffect(() => { void load(); }, [load]);

  async function send(url: string, method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Failed (${res.status})`);
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const name = draftName.trim();
    if (!name) return;
    const body: Record<string, unknown> = { name };
    if (hasEmoji && draftEmoji.trim()) body.emoji = draftEmoji.trim();
    if (hasPlatform && draftPlatform) body.platform = draftPlatform;
    if (buckets) body.bucket = draftBucket;
    if (await send(`/api/settings/taxonomy/${kind}`, "POST", body)) {
      setDraftName("");
      setDraftEmoji("");
      setDraftPlatform("");
      setAdding(false);
    }
  }

  async function remove(item: Item) {
    const ok = await confirm({
      title: `Remove "${item.name}"?`,
      description: buckets
        ? "Campaigns using this status keep the group it belongs to, so nothing is left pointing at a status that no longer exists."
        : "It is removed from every creator and campaign it was applied to.",
      confirmLabel: "Remove",
      tone: "danger",
    });
    if (!ok) return;
    await send(`/api/settings/taxonomy/${kind}/${item.id}`, "DELETE");
  }

  /* Their deliverable chip leads with the platform's own mark and carries no
     text badge: MEASURED at desktop-1600, the label sits 61px into a 42px-tall
     pill and the chip ends 51px after it. Ours led with 6px and trailed 130.3
     -- the uppercase `INSTAGRAM` badge was the difference, which is why this
     moves rather than being restyled. */
  const glyph = (item: Item) =>
    item.platform ? <PlatformGlyph className="cc-chip-glyph" platform={item.platform} size="var(--cc-chip-glyph-size)" /> : null;

  const label = (item: Item) => (
    <span className="cc-chip-label">
      {item.emoji ? <span className="cc-chip-emoji">{item.emoji}</span> : null}
      {item.name}
    </span>
  );

  /* MEASURED 2026-09-14 at desktop-1600, their Settings -> General flag row:
       chip   612,417.5 195.6x25   fill rgb(242,244,251)
       emoji  618,422   15x15      12/500
       label  638,420.5 118.6x19   15/400
       edit   768.6,423 15x14   delete  786.6,423 15x14   chip ends 807.6
     i.e. 6px of padding, a 12px emoji, 5px to the label, 12px to the actions
     and 3px between them. Ours was 35.4 tall with a 13px emoji jammed against
     the label and a single 13px bin -- so every chip after the first sat 20px
     to the left of theirs, which is what made four labels and four emoji read
     as eight separate findings. The two-icon cluster is theirs, and it is what
     makes the widths agree. */
  const chip = (item: Item) => (
    <span key={item.id} className="cc-chip">
      {renaming === item.id ? (
        <>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            aria-label={`Rename ${item.name}`}
            autoFocus
            style={{
              border: "1px solid var(--cc-border)", borderRadius: 6,
              padding: "2px 6px", fontSize: "var(--cc-t-13)", width: 160,
              color: "var(--cc-text)", background: "var(--cc-card)",
            }}
          />
          <button
            type="button" aria-label={`Save ${item.name}`} disabled={busy}
            onClick={async () => {
              const next = renameValue.trim();
              if (next && next !== item.name) {
                if (!(await send(`/api/settings/taxonomy/${kind}/${item.id}`, "PATCH", { name: next }))) return;
              }
              setRenaming(null);
            }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-primary)", display: "inline-flex" }}
          >
            <Check size={14} aria-hidden="true" />
          </button>
          <button
            type="button" aria-label={`Cancel renaming ${item.name}`}
            onClick={() => setRenaming(null)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", display: "inline-flex" }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </>
      ) : !canManage ? (
        <>
          {glyph(item)}
          {label(item)}
        </>
      ) : (
        <>
          {glyph(item)}
          {label(item)}
          <span className="cc-chip-actions">
            <button
              type="button" aria-label={`Rename ${item.name}`} disabled={busy}
              onClick={() => { setRenaming(item.id); setRenameValue(item.name); }}
              className="cc-chip-action"
            >
              <Pencil aria-hidden="true" />
            </button>
            <button
              type="button" aria-label={`Remove ${item.name}`} disabled={busy}
              onClick={() => void remove(item)}
              className="cc-chip-action"
            >
              <Trash2 aria-hidden="true" />
            </button>
          </span>
        </>
      )}
    </span>
  );

  return (
    <SectionCard
      icon={Tags}
      title={title}
      description={description}
      action={
        canManage
          ? !adding && (
              <Button variant="secondary" size="sm" iconLeft={<Plus size={14} />} onClick={() => setAdding(true)}>
                {addLabel}
              </Button>
            )
          : (
            <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>
              Read-only — only admins can change this list
            </span>
          )
      }
    >
      <div className="cc-taxonomy-list" data-kind={kind}>
        {items === null ? (
          <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>Loading…</p>
        ) : items.length === 0 && !adding ? (
          <p className="cc-taxonomy-empty">{emptyLabel}</p>
        ) : buckets ? (
          // Grouped: every group is shown even when empty, because the groups are
          // the fixed part and their emptiness is information.
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {buckets
              .filter((b) => kind === "campaign-statuses" || items.some((i) => i.bucket === b.value))
              .map((b) => (
                <div key={b.value}>
                  <p className="cc-microlabel" style={{ marginBottom: 8 }}>
                    {b.label}
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {items.filter((i) => i.bucket === b.value).length === 0 ? (
                      <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)" }}>None</span>
                    ) : (
                      items.filter((i) => i.bucket === b.value).map(chip)
                    )}
                  </div>
                </div>
              ))}
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{items.map(chip)}</div>
        )}

        {adding && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {hasEmoji && (
              <Input
                value={draftEmoji}
                onChange={(e) => setDraftEmoji(e.target.value)}
                placeholder="⚡"
                aria-label="Flag emoji"
                style={{ width: 72 }}
              />
            )}
            <Input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Name"
              aria-label={`New ${title.toLowerCase()} name`}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
              style={{ minWidth: 220 }}
            />
            {buckets && (
              <Dropdown
                ariaLabel="Group"
                value={draftBucket}
                onChange={setDraftBucket}
                options={buckets.map((b) => ({ value: b.value, label: b.label }))}
                size="md"
                align="left"
                minWidth={170}
              />
            )}
            {hasPlatform && (
              <Dropdown
                ariaLabel="Platform"
                value={draftPlatform}
                onChange={setDraftPlatform}
                placeholder="Any platform"
                options={[{ value: "", label: "Any platform" }, ...PLATFORMS.map((p) => ({ value: p, label: p }))]}
                size="md"
                align="left"
                minWidth={170}
              />
            )}
            <Button variant="primary" size="sm" onClick={() => void add()} disabled={busy || !draftName.trim()}>
              Add
            </Button>
            <Button variant="secondary" size="sm" onClick={() => { setAdding(false); setDraftName(""); }}>
              Cancel
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-danger)" }}>{error}</p>
        )}
      </div>
    </SectionCard>
  );
}

export default function GeneralClient({ canManage }: { canManage: boolean }) {
  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="General Settings"
        subtitle="The tags, flags, deliverable types and statuses this workspace uses."
      />

      {/* The stack, not the individual cards, is the card on the reference.
          MEASURED at desktop-1600: theirs paints ONE white panel 291,104
          1293x2058 holding every section as a flush transparent row, titled
          `Tags & Statuses`; ours painted five separate 1293x178.6 panels with
          20px of page background between them. The class is what lets the
          theme make that swap -- the inline style this replaces could not be
          re-pointed by any rule. */}
      <div className="cc-section-stack">
        <h2 className="cc-section-stack-title">Tags &amp; Statuses</h2>
        <TaxonomyList
          canManage={canManage}
          kind="creator-tags"
          title="Creator Tags"
          description="Categorise and label creators by their general attributes — the niche they work in, the audience they reach, the kind of brief they suit."
          addLabel="Add Creator Tag"
          emptyLabel="No Creator Tags yet."
        />
        <TaxonomyList
          canManage={canManage}
          kind="creator-flags"
          title="Creator Flags"
          description="Highlight a creator's current status or a standing attribute — fast turnaround, strong view rates, on a break, not responding. Flags show wherever the creator is listed."
          addLabel="Add Creator Flag"
          emptyLabel="No Creator Flags yet."
        />
        <TaxonomyList
          canManage={canManage}
          kind="campaign-tags"
          title="Campaign Tags"
          description="Categorise and label campaigns, for example “Fashion” or “Q4 Launch”, and filter on them."
          addLabel="Add Campaign Tag"
          emptyLabel="No Campaign Tags Found"
        />
        <TaxonomyList
          canManage={canManage}
          kind="deliverable-types"
          title="Deliverable Types"
          description="The deliverables campaigns can ask for, such as an Instagram Reel or a TikTok song promo."
          addLabel="New Deliverable Type"
          emptyLabel="No Deliverable Types yet."
        />
        <TaxonomyList
          canManage={canManage}
          kind="campaign-statuses"
          title="Campaign Statuses"
          description="Your own names for where a campaign stands. Each one sits in a fixed group, and the group is what lists and reports filter on."
          addLabel="New Campaign Status"
          emptyLabel="No Campaign Statuses yet."
        />
        <TaxonomyList
          canManage={canManage}
          kind="activation-statuses"
          title="Activation Statuses"
          description="Your own names for where a single creator's activation stands within a campaign."
          addLabel="New Activation Status"
          emptyLabel="No Activation Statuses yet."
        />
      </div>
    </div>
  );
}
