"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { Badge } from "@pratham7711/ui";
import { toast } from "sonner";
import { formatFull, stripAt } from "@/lib/format";
import { DECISION_BADGE, DECISION_LABELS, type ListItemDecision } from "@/lib/lists/approval";
import CreatorAvatar from "@/components/creators/CreatorAvatar";

export type RateCardItem = {
  id: string;
  creator: {
    id: string;
    name: string;
    handle: string;
    platform: string;
    followersCount: number;
    avgViews: number | null;
    engagementRate: number | null;
  };
  detail: {
    rate: number | null;
    notes: string | null;
    decision: ListItemDecision;
    decisionNote: string | null;
    decidedAt: string | null;
  };
};

const COLUMNS = "56px minmax(180px, 1fr) 96px 92px 80px 120px minmax(140px, 1fr) 150px 40px";

/**
 * The list's creators as an editable rate card: the agency's quoted rate and
 * note per creator, the client's verdict beside them, and the row order the
 * share link presents.
 *
 * Cells save on blur rather than per keystroke -- a rate is typed digit by
 * digit, and saving each one would be a write per character fighting the
 * cursor. Rows move with up/down buttons, which a keyboard can reach.
 */
export default function RateCardTable({
  listId,
  items,
  onChanged,
  onRemove,
}: {
  listId: string;
  items: RateCardItem[];
  onChanged: () => void;
  onRemove: (itemId: string, creatorId: string) => void;
}) {
  const [moving, setMoving] = useState(false);

  async function save(creatorId: string, patch: { rate?: string; notes?: string }) {
    const res = await fetch(`/api/lists/${listId}/creators/${creatorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    if (!res?.ok) {
      const data = await res?.json().catch(() => null);
      toast.error(data?.error ?? "That didn't save. Try again.");
      return;
    }
    onChanged();
  }

  async function move(index: number, by: -1 | 1) {
    const order = items.map((i) => i.creator.id);
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    setMoving(true);
    const res = await fetch(`/api/lists/${listId}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ creatorIds: order }),
    }).catch(() => null);
    setMoving(false);
    if (!res?.ok) toast.error("Couldn't move that row. Reload and try again.");
    onChanged();
  }

  return (
    <div className="rsp-table-wrap">
      <div style={{ minWidth: 1000 }}>
        <div style={{ display: "grid", gridTemplateColumns: COLUMNS, gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)" }}>
          {["Order", "Creator", "Followers", "Avg Views", "Eng. rate", "Rate (USD)", "Notes", "Client", ""].map((h, i) => (
            <span key={`${h}-${i}`} className="cc-microlabel">
              {h}
            </span>
          ))}
        </div>
        <div className="cc-stagger">
          {items.map((item, i) => (
            <div
              key={item.id}
              className="cc-table-row"
              style={{ display: "grid", gridTemplateColumns: COLUMNS, gap: 12, padding: "12px 24px", alignItems: "center", borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}
            >
              <span style={{ display: "flex", gap: 2 }}>
                <button type="button" className="cc-icon-btn" aria-label={`Move ${item.creator.name} up`} disabled={moving || i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={14} aria-hidden />
                </button>
                <button
                  type="button"
                  className="cc-icon-btn"
                  aria-label={`Move ${item.creator.name} down`}
                  disabled={moving || i === items.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown size={14} aria-hidden />
                </button>
              </span>
              <Link prefetch={false} href={`/creators/${item.creator.id}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <CreatorAvatar id={item.creator.id} name={item.creator.name} size="sm" />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{item.creator.name}</p>
                  <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>@{stripAt(item.creator.handle)}</p>
                </div>
              </Link>
              <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{formatFull(item.creator.followersCount)}</span>
              <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{item.creator.avgViews ? formatFull(item.creator.avgViews) : "—"}</span>
              <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
                {item.creator.engagementRate != null ? `${item.creator.engagementRate.toFixed(2)}%` : "—"}
              </span>
              <input
                key={`rate-${item.id}-${item.detail.rate ?? ""}`}
                className="cc-field"
                inputMode="decimal"
                defaultValue={item.detail.rate ?? ""}
                placeholder="—"
                aria-label={`Rate for ${item.creator.name}`}
                onBlur={(e) => {
                  if (e.currentTarget.value !== String(item.detail.rate ?? "")) void save(item.creator.id, { rate: e.currentTarget.value });
                }}
              />
              <input
                key={`notes-${item.id}-${item.detail.notes ?? ""}`}
                className="cc-field"
                defaultValue={item.detail.notes ?? ""}
                maxLength={2000}
                placeholder="Add a note"
                aria-label={`Notes on ${item.creator.name}`}
                onBlur={(e) => {
                  if (e.currentTarget.value !== (item.detail.notes ?? "")) void save(item.creator.id, { notes: e.currentTarget.value });
                }}
              />
              <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <Badge variant={DECISION_BADGE[item.detail.decision]}>{DECISION_LABELS[item.detail.decision]}</Badge>
                {item.detail.decisionNote && (
                  <span title={item.detail.decisionNote} style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    “{item.detail.decisionNote}”
                  </span>
                )}
              </span>
              <button
                type="button"
                className="cc-icon-btn"
                onClick={() => onRemove(item.id, item.creator.id)}
                aria-label={`Remove ${item.creator.name} from list`}
                title="Remove from list"
              >
                <Trash2 size={14} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
