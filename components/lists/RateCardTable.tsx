"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { stripAt } from "@/lib/format";
import { DECISION_LABELS, type ListItemDecision } from "@/lib/lists/approval";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import MetricFigure from "@/components/creators/MetricFigure";
import { avgViewsValue, followersValue } from "@/lib/creators/metricValue";
import { DataTable, MoreMenu, StatusBadge, type DataTableColumn, type StatusTone } from "@/components/ds";

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

const DECISION_TONE: Record<ListItemDecision, StatusTone> = {
  PENDING: "neutral",
  APPROVED: "success",
  REJECTED: "danger",
};

/** The creator cell shared by both list tables: avatar, name, handle. */
export function ListCreatorCell({ creator, link = false }: { creator: { id: string; name: string; handle: string }; link?: boolean }) {
  const body = (
    <>
      <CreatorAvatar id={creator.id} name={creator.name} size="sm" />
      <span className="cc-creator-cell-text">
        <span className="cc-dt-truncate">{creator.name}</span>
        <span className="cc-dt-sub cc-dt-truncate">@{stripAt(creator.handle)}</span>
      </span>
    </>
  );
  return link ? (
    <Link prefetch={false} href={`/creators/${creator.id}`} className="cc-creator-cell cc-dt-primary">
      {body}
    </Link>
  ) : (
    <span className="cc-creator-cell">{body}</span>
  );
}

/**
 * The list's creators as an editable rate card: the agency's quoted rate and
 * note per creator, the client's verdict beside them, and the row order the
 * share link presents.
 *
 * Cells save on blur rather than per keystroke -- a rate is typed digit by
 * digit, and saving each one would be a write per character fighting the
 * cursor. Rows move from the row's ⋯ menu, which a keyboard can reach.
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
  onRemove: (itemId: string, creatorId: string, name: string) => void;
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

  const columns: DataTableColumn<RateCardItem>[] = [
    {
      key: "creator",
      header: "Creator",
      minWidth: 220,
      render: (item) => <ListCreatorCell creator={item.creator} link />,
    },
    {
      key: "followers",
      header: "Followers",
      width: 112,
      align: "right",
      // followersCount defaults to 0 for a creator nobody has read, and this is
      // the view a client approves from: "—" with the reason.
      render: (item) => <MetricFigure value={followersValue(item.creator.followersCount)} />,
    },
    {
      key: "avgViews",
      header: "Avg. views",
      width: 112,
      align: "right",
      render: (item) => <MetricFigure value={avgViewsValue(item.creator.avgViews)} />,
    },
    {
      key: "eng",
      header: "Eng. rate",
      width: 96,
      align: "right",
      render: (item) => (item.creator.engagementRate != null ? `${item.creator.engagementRate.toFixed(2)}%` : "—"),
    },
    {
      key: "rate",
      header: "Rate (USD)",
      width: 128,
      align: "right",
      render: (item) => (
        <input
          key={`rate-${item.id}-${item.detail.rate ?? ""}`}
          className="cc-field cc-ratecard-rate"
          inputMode="decimal"
          defaultValue={item.detail.rate ?? ""}
          placeholder="—"
          aria-label={`Rate for ${item.creator.name}`}
          onBlur={(e) => {
            if (e.currentTarget.value !== String(item.detail.rate ?? "")) void save(item.creator.id, { rate: e.currentTarget.value });
          }}
        />
      ),
    },
    {
      key: "notes",
      header: "Notes",
      minWidth: 180,
      render: (item) => (
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
      ),
    },
    {
      key: "client",
      header: "Client",
      width: 160,
      render: (item) => (
        <>
          <StatusBadge tone={DECISION_TONE[item.detail.decision]}>{DECISION_LABELS[item.detail.decision]}</StatusBadge>
          {item.detail.decisionNote && (
            <span className="cc-dt-sub cc-dt-truncate" title={item.detail.decisionNote}>
              “{item.detail.decisionNote}”
            </span>
          )}
        </>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      width: 64,
      render: (item, i) => (
        <MoreMenu
          size="sm"
          label={`More actions for ${item.creator.name}`}
          items={[
            { label: "Move up", icon: <ArrowUp size={15} />, onClick: () => move(i, -1), disabled: moving || i === 0 },
            { label: "Move down", icon: <ArrowDown size={15} />, onClick: () => move(i, 1), disabled: moving || i === items.length - 1 },
            {
              label: "Remove from list",
              icon: <Trash2 size={15} />,
              onClick: () => onRemove(item.id, item.creator.id, item.creator.name),
              danger: true,
              startsGroup: true,
            },
          ]}
        />
      ),
    },
  ];

  return (
    <DataTable
      className="cc-actions-table"
      caption="Rate card: creators on this list, in the order the share link shows them"
      columns={columns}
      rows={items}
      rowKey={(item) => item.id}
    />
  );
}
