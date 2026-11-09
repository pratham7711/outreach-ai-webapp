"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { EmptyState } from "@pratham7711/ui";
import {
  PageHeader,
  Button,
  DataTable,
  LoadError,
  MetricTile,
  NoResults,
  Skeleton,
  StatusBadge,
  StatusTabs,
  type DataTableColumn,
} from "@/components/ds";
import { CalendarClock, AlertTriangle, CheckCircle2, Clock, CalendarOff, Pencil, X, Check } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { formatFull, platformLabel, stripAt } from "@/lib/format";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { DEADLINES_WIDTHS } from "./columns";

type DeadlineActivation = {
  id: string;
  status: string;
  deliverableDueDate: string | null;
  feedbackNotes: string | null;
  creator: { id: string; name: string; handle: string | null; platform: string };
  campaign: { id: string; title: string; status: string };
};

type Stats = {
  total: number;
  overdue: number;
  dueThisWeek: number;
  completed: number;
  noDate: number;
};

const FILTER_TABS = [
  { key: "ALL", label: "All" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "THIS_WEEK", label: "Due this week" },
  { key: "UPCOMING", label: "Upcoming" },
  { key: "NO_DATE", label: "No date set" },
];

function DaysLeft({ dueDate, status }: { dueDate: string | null; status: string }) {
  if (!dueDate) return <span style={{ color: "var(--cc-text-muted)" }}>—</span>;
  if (["COMPLETE", "DECLINED"].includes(status)) {
    return <span style={{ color: "var(--cc-success-fg)" }}>Done</span>;
  }

  const due = new Date(dueDate);
  const now = new Date();
  const days = differenceInDays(due, now);

  if (days < 0) {
    return (
      <span style={{ fontWeight: "var(--cc-fw-strong)", color: "var(--cc-danger-ink)" }}>
        {Math.abs(days)}d overdue
      </span>
    );
  }
  if (days === 0) {
    return <span style={{ fontWeight: "var(--cc-fw-strong)", color: "var(--cc-warning-ink)" }}>Due today</span>;
  }
  if (days <= 3) {
    return <span style={{ fontWeight: "var(--cc-fw-strong)", color: "var(--cc-warning-ink)" }}>{days}d left</span>;
  }
  return <span style={{ color: "var(--cc-text-muted)" }}>{days}d left</span>;
}

function InlineDateEditor({
  activationId,
  creatorName,
  current,
  onSaved,
}: {
  activationId: string;
  creatorName: string;
  current: string | null;
  onSaved: (id: string, date: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ? format(new Date(current), "yyyy-MM-dd") : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A rejected PATCH used to close the editor and paint the new date anyway, so
  // the row lied until the next reload. Keep the editor open and say what failed.
  const patch = async (isoDate: string | null) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/activations/${activationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deliverableDueDate: isoDate }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not save the due date");
      }
      setEditing(false);
      onSaved(activationId, isoDate);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the due date");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    await patch(value ? new Date(value).toISOString() : null);
  };

  const clear = async () => {
    if (await patch(null)) setValue("");
  };

  if (!editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ color: current ? "var(--cc-text)" : "var(--cc-text-muted)" }}>
          {current ? format(new Date(current), "MMM d, yyyy") : "Not set"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Edit due date for ${creatorName}`}
          title="Edit due date"
          onClick={() => setEditing(true)}
        >
          <Pencil size={14} aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      <input
        type="date"
        className="cc-field"
        aria-label={`Due date for ${creatorName}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: "auto", flex: "1 1 8.5rem", minWidth: 0 }}
        autoFocus
      />
      <Button
        variant="primary"
        size="sm"
        onClick={save}
        loading={saving}
        aria-label="Save due date"
        title="Save due date"
      >
        <Check size={14} aria-hidden="true" />
      </Button>
      {current && (
        <Button
          variant="ghost"
          size="sm"
          className="cc-btn-danger-ghost"
          onClick={clear}
          disabled={saving}
          aria-label="Clear due date"
          title="Clear due date"
        >
          <X size={14} aria-hidden="true" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => { setEditing(false); setError(null); }}
        aria-label="Cancel editing the due date"
      >
        Cancel
      </Button>
      {error && (
        <span role="alert" className="cc-form-error" style={{ width: "100%" }}>
          {error}
        </span>
      )}
    </div>
  );
}

export default function DeadlinesPage() {
  const [activations, setActivations] = useState<DeadlineActivation[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, overdue: 0, dueThisWeek: 0, completed: 0, noDate: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [error, setError] = useState<string | null>(null);

  const load = async (f: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deadlines?filter=${f}`);
      if (!res.ok) throw new Error("Failed to load deadlines");
      const data = await res.json();
      setActivations(Array.isArray(data.activations) ? data.activations : []);
      setStats(data.stats);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(filter); }, [filter]);

  const handleDateSaved = (id: string, newDate: string | null) => {
    setActivations(prev =>
      prev.map(a => a.id === id ? { ...a, deliverableDueDate: newDate } : a)
    );
    // Reload stats
    load(filter);
  };

  /* Five tiles all reading 0 above "No deadlines found" is five measurements of
     nothing. The stats come from the API and describe the whole org, not the
     current tab, so this is "has this org any deliverables at all" rather than
     "did this filter match". */
  const hasAnyDeadlineData = Object.values(stats).some((v) => v > 0);
  const tile = (n: number) => (loading ? <Skeleton width={48} height={28} /> : formatFull(n));

  const columns: DataTableColumn<DeadlineActivation>[] = [
    {
      key: "creator",
      header: "Creator",
      minWidth: 220,
      render: (a) => (
        <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <CreatorAvatar id={a.creator.id} name={a.creator.name} size="sm" />
          <span style={{ minWidth: 0 }}>
            <span className="cc-dt-truncate" style={{ fontWeight: "var(--cc-fw-medium)" }} title={a.creator.name}>
              {a.creator.name}
            </span>
            {a.creator.handle && (
              <span className="cc-dt-sub cc-dt-truncate">
                @{stripAt(a.creator.handle)} · {platformLabel(a.creator.platform)}
              </span>
            )}
          </span>
        </span>
      ),
    },
    {
      key: "campaign",
      header: "Campaign",
      minWidth: 180,
      render: (a) => (
        <Link prefetch={false} href={`/campaigns/${a.campaign.id}`} className="cc-dt-primary cc-dt-truncate" title={a.campaign.title}>
          {a.campaign.title}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: DEADLINES_WIDTHS.status,
      render: (a) => (
        <StatusBadge status={a.status} />
      ),
    },
    {
      key: "due",
      header: "Due date",
      width: DEADLINES_WIDTHS.due,
      render: (a) => (
        <InlineDateEditor
          activationId={a.id}
          creatorName={a.creator.name}
          current={a.deliverableDueDate}
          onSaved={handleDateSaved}
        />
      ),
    },
    {
      key: "daysLeft",
      header: "Days left",
      width: DEADLINES_WIDTHS.daysLeft,
      align: "right",
      render: (a) => <DaysLeft dueDate={a.deliverableDueDate} status={a.status} />,
    },
  ];

  return (
    <div className="rsp-page">
      <PageHeader
        title="Deadlines"
        subtitle="Track deliverable due dates across all campaigns"
        tabs={
          <StatusTabs
            ariaLabel="Filter deadlines"
            tabs={FILTER_TABS.map((t) => ({
              key: t.key,
              label: t.label,
              count:
                t.key === "OVERDUE" && stats.overdue > 0
                  ? stats.overdue
                  : t.key === "THIS_WEEK" && stats.dueThisWeek > 0
                    ? stats.dueThisWeek
                    : undefined,
            }))}
            active={filter}
            onChange={setFilter}
          />
        }
      />

      {(loading || hasAnyDeadlineData) && (
        <div className="cc-tiles-balanced" style={{ marginBottom: 24 }} aria-busy={loading || undefined}>
          <MetricTile icon={CalendarClock} label="With deadlines" value={tile(stats.total)} />
          <MetricTile
            icon={AlertTriangle}
            label="Overdue"
            value={
              !loading && stats.overdue > 0 ? (
                <span style={{ color: "var(--cc-danger-ink)" }}>{formatFull(stats.overdue)}</span>
              ) : (
                tile(stats.overdue)
              )
            }
          />
          <MetricTile icon={Clock} label="Due this week" value={tile(stats.dueThisWeek)} />
          <MetricTile icon={CheckCircle2} label="Completed" value={tile(stats.completed)} />
          <MetricTile icon={CalendarOff} label="No date set" value={tile(stats.noDate)} />
        </div>
      )}

      {error ? (
        <LoadError
          title="We couldn't load deadlines"
          description={error}
          onRetry={() => load(filter)}
          retrying={loading}
        />
      ) : (
        <DataTable
          caption="Deliverable deadlines"
          columns={columns}
          rows={activations}
          rowKey={(a) => a.id}
          loading={loading}
          skeletonRows={5}
          empty={
            filter === "ALL" ? (
              <EmptyState
                icon={<CalendarClock size={32} color="var(--cc-text-subtle)" />}
                title="No deadlines yet"
                description="Due dates you set on an activation's deliverable show up here."
              />
            ) : (
              /* "No activations match this filter" was shown on the All tab too,
                 where nothing is filtered — telling a new org to narrow a filter it
                 has not set. */
              <NoResults
                title="No deadlines found"
                description={
                  filter === "NO_DATE" ? "All activations have due dates set." : "No activations match this filter."
                }
                onClear={() => setFilter("ALL")}
                clearLabel="Show all"
              />
            )
          }
        />
      )}
    </div>
  );
}
