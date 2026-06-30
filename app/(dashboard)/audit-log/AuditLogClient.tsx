"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, RefreshCw, ChevronLeft, ChevronRight, Filter, Download } from "lucide-react";
import { Card, EmptyState, LoadingSpinner } from "@pratham7711/ui";

type AuditLogItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  actorType: string;
  actorEmail: string | null;
  ipAddress: string | null;
  metadata: unknown;
  before: unknown;
  after: unknown;
  createdAt: string;
};

type Pagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ApiResponse = {
  logs: AuditLogItem[];
  pagination: Pagination;
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function labelValue(label?: string | null, fallback?: string | null) {
  return label?.trim() || fallback?.trim() || "—";
}

export default function AuditLogClient({
  initialLogs,
  initialPagination,
}: {
  initialLogs: AuditLogItem[];
  initialPagination: Pagination;
}) {
  const [logs, setLogs] = useState<AuditLogItem[]>(initialLogs);
  const [pagination, setPagination] = useState<Pagination>(initialPagination);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);

  const filters = useMemo(
    () => ({
      action: action.trim(),
      entityType: entityType.trim(),
      q: q.trim(),
      page,
      pageSize: initialPagination.pageSize,
    }),
    [action, entityType, q, page, initialPagination.pageSize]
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function run() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("page", String(filters.page));
        params.set("pageSize", String(filters.pageSize));
        if (filters.action) params.set("action", filters.action);
        if (filters.entityType) params.set("entityType", filters.entityType);
        if (filters.q) params.set("q", filters.q);

        const res = await fetch(`/api/audit-logs?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;

        const data = (await res.json()) as ApiResponse;
        if (cancelled) return;
        setLogs(data.logs ?? []);
        setPagination(data.pagination ?? initialPagination);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Failed to load audit logs:", error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [filters, initialPagination]);

  const totalRangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1;
  const totalRangeEnd = Math.min(pagination.page * pagination.pageSize, pagination.total);

  const actions = Array.from(new Set(logs.map((log) => log.action))).sort();
  const entityTypes = Array.from(new Set(logs.map((log) => log.entityType))).sort();

  return (
    <div className="cc-page-content">
      <div style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", marginBottom: 4 }}>
            Audit Log
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Track changes across your organization
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            <Filter size={14} />
            {pagination.total} events
          </span>
          <a
            href={`/api/audit-logs/csv?${new URLSearchParams(
              Object.fromEntries(
                [
                  ["action", action],
                  ["entityType", entityType],
                  ["q", q],
                ].filter(([, v]) => v) as [string, string][]
              )
            ).toString()}`}
            download="audit-log.csv"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              height: 36,
              padding: "0 14px",
              borderRadius: 10,
              border: "1px solid var(--cc-border)",
              background: "var(--cc-card)",
              color: "var(--cc-text)",
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
              cursor: "pointer",
            }}
          >
            <Download size={14} />
            Export CSV
          </a>
        </div>
      </div>

      <Card variant="outlined" noPadding>
        <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1.2fr 1fr 1.4fr auto", gap: 12, borderBottom: "1px solid var(--cc-border)" }}>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cc-text-subtle)", marginBottom: 6 }}>Action</label>
            <select
              value={action}
              onChange={(e) => {
                setPage(1);
                setAction(e.target.value);
              }}
              style={{ width: "100%", height: 38, borderRadius: 10, border: "1px solid var(--cc-border)", background: "var(--cc-card)", color: "var(--cc-text)", padding: "0 12px" }}
            >
              <option value="">All actions</option>
              {actions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cc-text-subtle)", marginBottom: 6 }}>Entity</label>
            <select
              value={entityType}
              onChange={(e) => {
                setPage(1);
                setEntityType(e.target.value);
              }}
              style={{ width: "100%", height: 38, borderRadius: 10, border: "1px solid var(--cc-border)", background: "var(--cc-card)", color: "var(--cc-text)", padding: "0 12px" }}
            >
              <option value="">All entities</option>
              {entityTypes.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--cc-text-subtle)", marginBottom: 6 }}>Search</label>
            <div style={{ position: "relative" }}>
              <Search size={15} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--cc-text-subtle)" }} />
              <input
                value={q}
                onChange={(e) => {
                  setPage(1);
                  setQ(e.target.value);
                }}
                placeholder="Search label, email, IP..."
                style={{ width: "100%", height: 38, borderRadius: 10, border: "1px solid var(--cc-border)", background: "var(--cc-card)", color: "var(--cc-text)", padding: "0 12px 0 34px" }}
              />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "end" }}>
            <button
              onClick={() => {
                setAction("");
                setEntityType("");
                setQ("");
                setPage(1);
              }}
              style={{ height: 38, borderRadius: 10, border: "1px solid var(--cc-border)", background: "transparent", color: "var(--cc-text-muted)", padding: "0 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
            >
              <RefreshCw size={14} />
              Reset
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 40 }}>
            <LoadingSpinner size={24} />
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 24 }}>
            <EmptyState
              icon="🧾"
              title="No audit events"
              description="Changes made in this organization will appear here."
            />
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr style={{ background: "var(--cc-hover-bg)" }}>
                    {["Time", "Action", "Entity", "Actor", "IP"].map((heading) => (
                      <th
                        key={heading}
                        style={{ padding: "12px 16px", textAlign: "left", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} style={{ borderTop: "1px solid var(--cc-border)" }}>
                      <td style={{ padding: "12px 16px", whiteSpace: "nowrap", color: "var(--cc-text-muted)" }}>
                        {formatDate(log.createdAt)}
                      </td>
                      <td style={{ padding: "12px 16px", fontWeight: 600, color: "var(--cc-text)" }}>
                        {log.action}
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--cc-text-muted)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ color: "var(--cc-text)", fontWeight: 500 }}>{log.entityType}</span>
                          <span>{labelValue(log.entityLabel, log.entityId)}</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--cc-text-muted)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ color: "var(--cc-text)", fontWeight: 500 }}>{labelValue(log.actorEmail, log.actorType)}</span>
                          <span>{log.actorType}</span>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--cc-text-muted)" }}>{log.ipAddress ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 16, borderTop: "1px solid var(--cc-border)", gap: 12, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                Showing {totalRangeStart}-{totalRangeEnd} of {pagination.total}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  disabled={pagination.page <= 1 || loading}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={{ height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid var(--cc-border)", background: "transparent", color: "var(--cc-text)", cursor: pagination.page <= 1 || loading ? "not-allowed" : "pointer", opacity: pagination.page <= 1 || loading ? 0.5 : 1, display: "flex", alignItems: "center", gap: 6 }}
                >
                  <ChevronLeft size={14} />
                  Prev
                </button>
                <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                  Page {pagination.page} of {pagination.totalPages}
                </span>
                <button
                  disabled={pagination.page >= pagination.totalPages || loading}
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  style={{ height: 36, padding: "0 12px", borderRadius: 10, border: "1px solid var(--cc-border)", background: "transparent", color: "var(--cc-text)", cursor: pagination.page >= pagination.totalPages || loading ? "not-allowed" : "pointer", opacity: pagination.page >= pagination.totalPages || loading ? 0.5 : 1, display: "flex", alignItems: "center", gap: 6 }}
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
