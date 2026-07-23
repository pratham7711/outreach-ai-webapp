"use client";
import { useState, useEffect } from "react";
import { Card, Badge, Skeleton, EmptyState, Button } from "@pratham7711/ui";
import { CalendarClock, AlertTriangle, CheckCircle2, Clock, CalendarOff, Edit2, X, Check } from "lucide-react";
import { format, isAfter, isBefore, differenceInDays } from "date-fns";
import { stripAt } from "@/lib/format";

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
  { key: "THIS_WEEK", label: "Due This Week" },
  { key: "UPCOMING", label: "Upcoming" },
  { key: "NO_DATE", label: "No Date Set" },
];

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  AWAITING_DRAFT: { bg: "#F3F4F6", color: "#6B7280" },
  DRAFT_SUBMITTED: { bg: "#FEF3C7", color: "#D97706" },
  AWAITING_APPROVAL: { bg: "#EEF2FF", color: "#4F46E5" },
  APPROVED: { bg: "#D1FAE5", color: "#059669" },
  POSTING: { bg: "#DBEAFE", color: "#2563EB" },
  POSTED: { bg: "#E0E7FF", color: "#4338CA" },
  COMPLETE: { bg: "#D1FAE5", color: "#059669" },
  DECLINED: { bg: "#FEE2E2", color: "#DC2626" },
};

function DaysLeft({ dueDate, status }: { dueDate: string | null; status: string }) {
  if (!dueDate) return <span style={{ fontSize: 12, color: "var(--cc-text-subtle)" }}>—</span>;
  if (["COMPLETE", "DECLINED"].includes(status)) {
    return <span style={{ fontSize: 12, color: "#059669" }}>Done</span>;
  }

  const due = new Date(dueDate);
  const now = new Date();
  const days = differenceInDays(due, now);

  if (days < 0) {
    return (
      <span style={{ fontSize: 12, fontWeight: 600, color: "#DC2626" }}>
        {Math.abs(days)}d overdue
      </span>
    );
  }
  if (days === 0) {
    return <span style={{ fontSize: 12, fontWeight: 600, color: "#D97706" }}>Due today</span>;
  }
  if (days <= 3) {
    return <span style={{ fontSize: 12, fontWeight: 600, color: "#D97706" }}>{days}d left</span>;
  }
  return <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{days}d left</span>;
}

function InlineDateEditor({
  activationId,
  current,
  onSaved,
}: {
  activationId: string;
  current: string | null;
  onSaved: (id: string, date: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ? format(new Date(current), "yyyy-MM-dd") : "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const isoDate = value ? new Date(value).toISOString() : null;
    await fetch(`/api/activations/${activationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliverableDueDate: isoDate }),
    });
    setSaving(false);
    setEditing(false);
    onSaved(activationId, isoDate);
  };

  const clear = async () => {
    setSaving(true);
    await fetch(`/api/activations/${activationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deliverableDueDate: null }),
    });
    setSaving(false);
    setValue("");
    setEditing(false);
    onSaved(activationId, null);
  };

  if (!editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 13, color: current ? "var(--cc-text)" : "var(--cc-text-subtle)" }}>
          {current ? format(new Date(current), "MMM d, yyyy") : "Not set"}
        </span>
        <button
          onClick={() => setEditing(true)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", padding: 2, display: "flex", alignItems: "center" }}
        >
          <Edit2 size={12} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input
        type="date"
        value={value}
        onChange={e => setValue(e.target.value)}
        style={{
          fontSize: 12, padding: "3px 6px", border: "1px solid var(--cc-border)",
          borderRadius: 6, color: "var(--cc-text)", background: "var(--cc-card)",
          outline: "none",
        }}
        autoFocus
      />
      <button
        onClick={save}
        disabled={saving}
        style={{ background: "var(--cc-primary)", border: "none", borderRadius: 4, padding: "3px 6px", cursor: "pointer", display: "flex", alignItems: "center" }}
      >
        <Check size={12} color="white" />
      </button>
      {current && (
        <button
          onClick={clear}
          disabled={saving}
          style={{ background: "#FEE2E2", border: "none", borderRadius: 4, padding: "3px 6px", cursor: "pointer", display: "flex", alignItems: "center" }}
        >
          <X size={12} color="#DC2626" />
        </button>
      )}
      <button
        onClick={() => setEditing(false)}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", padding: 2 }}
      >
        <X size={12} />
      </button>
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

  const isRowOverdue = (a: DeadlineActivation) => {
    if (!a.deliverableDueDate) return false;
    if (["COMPLETE", "DECLINED"].includes(a.status)) return false;
    return isBefore(new Date(a.deliverableDueDate), new Date());
  };

  return (
    <div className="rsp-page">
      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Deadlines</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Track deliverable due dates across all campaigns</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 24 }}>
        <Card variant="outlined" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <CalendarClock size={18} color="var(--cc-primary)" />
            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>With Deadlines</span>
          </div>
          <p style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
            {loading ? "—" : stats.total}
          </p>
        </Card>

        <Card variant="outlined" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <AlertTriangle size={18} color="#DC2626" />
            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>Overdue</span>
          </div>
          <p style={{ fontSize: 28, fontWeight: 700, color: stats.overdue > 0 ? "#DC2626" : "var(--cc-text)", margin: 0 }}>
            {loading ? "—" : stats.overdue}
          </p>
        </Card>

        <Card variant="outlined" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <Clock size={18} color="#D97706" />
            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>Due This Week</span>
          </div>
          <p style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
            {loading ? "—" : stats.dueThisWeek}
          </p>
        </Card>

        <Card variant="outlined" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <CheckCircle2 size={18} color="#059669" />
            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>Completed</span>
          </div>
          <p style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
            {loading ? "—" : stats.completed}
          </p>
        </Card>

        <Card variant="outlined" style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <CalendarOff size={18} color="var(--cc-text-muted)" />
            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>No Date Set</span>
          </div>
          <p style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
            {loading ? "—" : stats.noDate}
          </p>
        </Card>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {FILTER_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: "pointer",
              border: filter === tab.key ? "1.5px solid var(--cc-primary)" : "1.5px solid var(--cc-border)",
              background: filter === tab.key ? "var(--cc-primary)" : "var(--cc-card)",
              color: filter === tab.key ? "white" : "var(--cc-text-muted)",
              transition: "all 0.1s",
            }}
          >
            {tab.label}
            {tab.key === "OVERDUE" && stats.overdue > 0 && (
              <span style={{ marginLeft: 6, background: "#FEE2E2", color: "#DC2626", borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 600 }}>
                {stats.overdue}
              </span>
            )}
            {tab.key === "THIS_WEEK" && stats.dueThisWeek > 0 && (
              <span style={{ marginLeft: 6, background: "#FEF3C7", color: "#D97706", borderRadius: 10, padding: "1px 6px", fontSize: 11, fontWeight: 600 }}>
                {stats.dueThisWeek}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      {error ? (
        <Card variant="outlined" style={{ padding: 40, textAlign: "center" }}>
          <p style={{ color: "#DC2626", fontSize: 14 }}>{error}</p>
          <Button variant="secondary" size="sm" onClick={() => load(filter)} style={{ marginTop: 12 }}>Retry</Button>
        </Card>
      ) : loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...Array(5)].map((_, i) => <Skeleton key={i} width="100%" height="56px" borderRadius="8px" />)}
        </div>
      ) : activations.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={40} color="var(--cc-text-subtle)" />}
          title="No deadlines found"
          description={filter === "NO_DATE" ? "All activations have due dates set." : "No activations match this filter."}
        />
      ) : (
        <Card variant="outlined" noPadding>
          <div className="rsp-table-wrap">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--cc-border)" }}>
                {["Creator", "Campaign", "Status", "Due Date", "Days Left"].map(col => (
                  <th
                    key={col}
                    style={{
                      padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 600,
                      color: "var(--cc-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em",
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activations.map((a, idx) => {
                const overdue = isRowOverdue(a);
                return (
                  <tr
                    key={a.id}
                    style={{
                      borderBottom: idx < activations.length - 1 ? "1px solid var(--cc-border)" : "none",
                      background: overdue ? "rgba(220,38,38,0.03)" : "transparent",
                      transition: "background 0.1s",
                    }}
                  >
                    {/* Creator */}
                    <td style={{ padding: "14px 16px" }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>{a.creator.name}</p>
                      {a.creator.handle && (
                        <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "2px 0 0" }}>
                          @{stripAt(a.creator.handle)} · {a.creator.platform}
                        </p>
                      )}
                    </td>

                    {/* Campaign */}
                    <td style={{ padding: "14px 16px" }}>
                      <a
                        href={`/campaigns/${a.campaign.id}`}
                        style={{ fontSize: 13, color: "var(--cc-primary)", textDecoration: "none", fontWeight: 500 }}
                      >
                        {a.campaign.title}
                      </a>
                    </td>

                    {/* Activation Status */}
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 12,
                        background: STATUS_COLORS[a.status]?.bg ?? "#F3F4F6",
                        color: STATUS_COLORS[a.status]?.color ?? "#6B7280",
                      }}>
                        {a.status.replace(/_/g, " ")}
                      </span>
                    </td>

                    {/* Due Date (inline editor) */}
                    <td style={{ padding: "14px 16px" }}>
                      <InlineDateEditor
                        activationId={a.id}
                        current={a.deliverableDueDate}
                        onSaved={handleDateSaved}
                      />
                    </td>

                    {/* Days Left */}
                    <td style={{ padding: "14px 16px" }}>
                      <DaysLeft dueDate={a.deliverableDueDate} status={a.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Card>
      )}
    </div>
  );
}
