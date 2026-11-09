"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, History, X } from "lucide-react";
import {
  DataTable,
  Dropdown,
  ListToolbar,
  LoadError,
  NoResults,
  PageHeader,
  Pagination,
  type DataTableColumn,
} from "@/components/ds";
import { enumLabel } from "@/lib/ui/enumLabel";
import { action as uiAction } from "@/lib/ui/actions";
import { AUDIT_LOG_PAGE_SIZES, AUDIT_LOG_WIDTHS } from "./columns";

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

type PageInfo = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

type ApiResponse = {
  logs: AuditLogItem[];
  pagination: PageInfo;
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

/** "activation.create" -> "Activation create"; "CampaignDeposit" -> "Campaign deposit". */
function readable(key: string) {
  return enumLabel(key.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[.]/g, "_"));
}

const SEARCH_DELAY_MS = 250;

const COLUMNS: DataTableColumn<AuditLogItem>[] = [
  {
    key: "time",
    header: "Time",
    width: AUDIT_LOG_WIDTHS.time,
    render: (log) => formatDate(log.createdAt),
  },
  {
    key: "action",
    header: "Action",
    width: AUDIT_LOG_WIDTHS.action,
    truncate: (log) => log.action,
    render: (log) => readable(log.action),
  },
  {
    key: "entity",
    header: "Entity",
    minWidth: 200,
    render: (log) => (
      <>
        <span className="cc-dt-truncate" title={log.entityLabel?.trim() || log.entityId || undefined}>
          {log.entityLabel?.trim() || log.entityId?.trim() || "—"}
        </span>
        <span className="cc-dt-sub">{readable(log.entityType)}</span>
      </>
    ),
  },
  {
    key: "actor",
    header: "Actor",
    width: AUDIT_LOG_WIDTHS.actor,
    render: (log) => (
      <>
        <span className="cc-dt-truncate" title={log.actorEmail ?? undefined}>
          {log.actorEmail?.trim() || enumLabel(log.actorType)}
        </span>
        {log.actorEmail?.trim() ? <span className="cc-dt-sub">{enumLabel(log.actorType)}</span> : null}
      </>
    ),
  },
  {
    key: "ip",
    header: "IP address",
    width: AUDIT_LOG_WIDTHS.ip,
    render: (log) => log.ipAddress ?? "—",
  },
];

/**
 * The audit log: the reference listing for the shared primitives -- ListToolbar
 * (search + quick filters), DataTable (headers stay, the empty state sits under
 * them), Pagination in the table foot, NoResults for a search that matched
 * nothing, skeleton rows while the first page of a new query loads.
 */
export default function AuditLogClient({
  initialLogs,
  initialPagination,
}: {
  initialLogs: AuditLogItem[];
  initialPagination: PageInfo;
}) {
  const [logs, setLogs] = useState<AuditLogItem[]>(initialLogs);
  const [pagination, setPagination] = useState<PageInfo>(initialPagination);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  /** Bumped by Try again; the fetch effect reads it so a retry re-runs the same query. */
  const [reloadKey, setReloadKey] = useState(0);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPagination.pageSize);

  /* The filter options are every value seen so far, not only the ones on the
     current page: derived from `logs` alone, picking an action shrank the
     Entity list to that action's entities and the other actions vanished. */
  const [seen, setSeen] = useState(() => ({
    actions: new Set(initialLogs.map((l) => l.action)),
    entities: new Set(initialLogs.map((l) => l.entityType)),
  }));

  /* Typing waits a beat before it queries, so a word is one request rather
     than one per keystroke. Clearing is immediate. */
  useEffect(() => {
    if (search.trim() === q) return;
    const t = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, search.trim() ? SEARCH_DELAY_MS : 0);
    return () => window.clearTimeout(t);
  }, [search, q]);

  const query = useMemo(
    () => ({ action, entityType, q, page, pageSize }),
    [action, entityType, q, page, pageSize],
  );

  /* The server already rendered page one with no filters; fetching it again on
     mount only flashed the table. Compared by value rather than with a
     "first run" flag, which dev's double-run effects would spend on the first
     pass. Once anything has been fetched, coming back to page one fetches. */
  const fetched = useRef(false);

  useEffect(() => {
    const isServerPage =
      !query.action && !query.entityType && !query.q && query.page === 1 && query.pageSize === initialPagination.pageSize;
    if (!fetched.current && reloadKey === 0 && isServerPage) return;
    fetched.current = true;
    const controller = new AbortController();
    let cancelled = false;

    async function run() {
      setLoading(true);
      setLoadFailed(false);
      try {
        const params = new URLSearchParams();
        params.set("page", String(query.page));
        params.set("pageSize", String(query.pageSize));
        if (query.action) params.set("action", query.action);
        if (query.entityType) params.set("entityType", query.entityType);
        if (query.q) params.set("q", query.q);

        const res = await fetch(`/api/audit-logs?${params.toString()}`, { signal: controller.signal });
        /* A failed read is shown as a failure, never as an empty log: an org
           told nothing happened, when nothing was read, is the one mistake an
           audit log cannot make. */
        if (!res.ok) {
          if (!cancelled) {
            setLogs([]);
            setLoadFailed(true);
          }
          return;
        }

        const data = (await res.json()) as ApiResponse;
        if (cancelled) return;
        const next = data.logs ?? [];
        setLogs(next);
        setPagination(data.pagination ?? initialPagination);
        setSeen((prev) => {
          const actions = new Set(prev.actions);
          const entities = new Set(prev.entities);
          next.forEach((l) => {
            actions.add(l.action);
            entities.add(l.entityType);
          });
          return actions.size === prev.actions.size && entities.size === prev.entities.size ? prev : { actions, entities };
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Failed to load audit logs:", error);
          if (!cancelled) {
            setLogs([]);
            setLoadFailed(true);
          }
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
  }, [query, initialPagination, reloadKey]);

  const filtered = !!(action || entityType || q);
  const clearFilters = () => {
    setAction("");
    setEntityType("");
    setSearch("");
    setQ("");
    setPage(1);
  };

  const actionOptions = [
    { value: "", label: "All actions" },
    ...[...seen.actions].sort().map((a) => ({ value: a, label: readable(a) })),
  ];
  const entityOptions = [
    { value: "", label: "All entities" },
    ...[...seen.entities].sort().map((e) => ({ value: e, label: readable(e) })),
  ];

  const csvParams = new URLSearchParams(
    Object.fromEntries([["action", action], ["entityType", entityType], ["q", q]].filter(([, v]) => v)),
  ).toString();

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Audit log"
        subtitle="Track changes across your organization"
        actions={
          <a
            href={`/api/audit-logs/csv${csvParams ? `?${csvParams}` : ""}`}
            download="audit-log.csv"
            className="ui-btn ui-btn-secondary ui-btn-md"
            data-cc-slot="secondary"
            {...uiAction("export-csv")}
          >
            <Download size={16} aria-hidden="true" />
            Export CSV
          </a>
        }
      />

      <ListToolbar
        search={{ value: search, onChange: setSearch, placeholder: "Search events", ariaLabel: "Search events by label, email or IP" }}
        end={
          <>
            <Dropdown
              ariaLabel="Action"
              size="md"
              align="right"
              value={action}
              onChange={(v) => {
                setPage(1);
                setAction(v);
              }}
              options={actionOptions}
            />
            <Dropdown
              ariaLabel="Entity"
              size="md"
              align="right"
              value={entityType}
              onChange={(v) => {
                setPage(1);
                setEntityType(v);
              }}
              options={entityOptions}
            />
            {/* With nothing matched, the empty state under the table carries
                this button; one is enough. */}
            {filtered && logs.length > 0 ? (
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-md" onClick={clearFilters}>
                <X size={16} aria-hidden="true" />
                Clear filters
              </button>
            ) : null}
          </>
        }
      />

      {loadFailed ? (
        <LoadError
          title="We couldn't load the audit log"
          description="These events were not read, which is not the same as no events having happened."
          onRetry={() => setReloadKey((k) => k + 1)}
        />
      ) : (
        <DataTable
          caption="Audit events"
          columns={COLUMNS}
          rows={logs}
          rowKey={(log) => log.id}
          loading={loading}
          skeletonRows={Math.min(pageSize, 10)}
          empty={
            filtered ? (
              <NoResults
                title="No events match"
                description="Nothing in the audit log matches this search and these filters."
                onClear={clearFilters}
              />
            ) : (
              <NoResults
                icon={<History size={32} strokeWidth={1.75} />}
                title="No events yet"
                description="Changes made in this organization will appear here."
              />
            )
          }
          footer={
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              total={pagination.total}
              pageSize={pagination.pageSize}
              loading={loading}
              onPageChange={setPage}
              pageSizeOptions={AUDIT_LOG_PAGE_SIZES}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          }
        />
      )}
    </div>
  );
}
