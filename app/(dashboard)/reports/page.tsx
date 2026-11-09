"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, BarChart3, FilePlus2 } from "lucide-react";
import { Input } from "@pratham7711/ui";
import { Modal } from "@/components/ds/Modal";
import { formatDateAbs } from "@/lib/format";
import {
  Button,
  DataTable,
  FeatureState,
  Field,
  LoadError,
  MoreMenu,
  NoResults,
  PageHeader,
  StatusBadge,
  useConfirm,
  type DataTableColumn,
} from "@/components/ds";
import { action } from "@/lib/ui/actions";
import { REPORT_WIDTHS } from "./columns";

interface Report {
  id: string;
  title: string;
  slug: string;
  shareToken: string;
  isPublic: boolean;
  createdAt: string;
  campaign: { id: string; title: string } | null;
}

export default function ReportsPage() {
  const confirm = useConfirm();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  async function fetchReports() {
    try {
      const res = await fetch("/api/reports");
      if (res.status === 403) {
        setFeatureDisabled(true);
        setError(null);
        setReports([]);
        setLoading(false);
        return;
      }
      if (res.ok) {
        setFeatureDisabled(false);
        setError(null);
        setReports(await res.json());
      } else {
        setError("We couldn't load reports right now.");
      }
    } catch {
      setError("We couldn't load reports right now.");
    }
    setLoading(false);
  }

  useEffect(() => { fetchReports(); }, []);

  async function createReport(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (res.status === 403) {
        setFeatureDisabled(true);
        setError(null);
        setOpen(false);
        setCreating(false);
        return;
      }
      if (res.ok) {
        setTitle("");
        setOpen(false);
        await fetchReports();
      } else {
        setError("We couldn't create that report right now.");
      }
    } catch {
      setError("We couldn't create that report right now.");
    }
    setCreating(false);
  }

  async function togglePublic(report: Report) {
    try {
      const res = await fetch(`/api/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: !report.isPublic }),
      });
      if (res.status === 403) {
        setFeatureDisabled(true);
        setError(null);
        return;
      }
      if (!res.ok) {
        setError("We couldn't update that report right now.");
        return;
      }
      await fetchReports();
    } catch {
      setError("We couldn't update that report right now.");
    }
  }

  async function deleteReport(report: Report) {
    const ok = await confirm({
      verb: "delete",
      subject: report.title,
      description:
        "Any share link to this report stops working immediately. The underlying campaign data is not affected. This can't be undone.",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/reports/${report.id}`, { method: "DELETE" });
      if (res.status === 403) {
        setFeatureDisabled(true);
        setError(null);
        return;
      }
      if (!res.ok) {
        setError("We couldn't delete that report right now.");
        return;
      }
      await fetchReports();
    } catch {
      setError("We couldn't delete that report right now.");
    }
  }

  /* Visibility used to change on a click on its badge, which was a span: no
     keyboard, no hint that it was a control. The badge now only states it,
     and the change sits in the row's ⋯ beside Delete. */
  const columns: DataTableColumn<Report>[] = [
    {
      key: "title",
      header: "Title",
      width: REPORT_WIDTHS.title,
      minWidth: 220,
      truncate: (r) => r.title,
      render: (r) => <span className="font-medium">{r.title}</span>,
    },
    {
      key: "campaign",
      header: "Campaign",
      width: REPORT_WIDTHS.campaign,
      truncate: (r) => r.campaign?.title,
      render: (r) => r.campaign?.title ?? "—",
    },
    {
      key: "created",
      header: "Created",
      width: REPORT_WIDTHS.created,
      render: (r) => formatDateAbs(r.createdAt),
    },
    {
      key: "visibility",
      header: "Visibility",
      width: REPORT_WIDTHS.visibility,
      render: (r) => <StatusBadge tone={r.isPublic ? "success" : "neutral"}>{r.isPublic ? "Public" : "Private"}</StatusBadge>,
    },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      align: "right",
      width: REPORT_WIDTHS.actions,
      render: (r) => (
        <MoreMenu
          size="sm"
          label={`More actions for ${r.title}`}
          items={[
            { label: r.isPublic ? "Make report private" : "Make report public", onClick: () => togglePublic(r) },
            { label: "Delete report", danger: true, onClick: () => deleteReport(r) },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Reports"
        subtitle="Create and share campaign reports"
        actions={
          <Button variant="primary" iconLeft={<Plus size={16} aria-hidden="true" />} onClick={() => setOpen(true)} {...action("new-report")}>
            New report
          </Button>
        }
      />

      {featureDisabled ? (
        <FeatureState
          kind="locked"
          title="Reports are turned off"
          body="Enable the reports feature in Billing to create and manage reports for this organization."
          action={
            <Link href="/settings/billing" className="ui-btn ui-btn-secondary ui-btn-sm" data-cc-slot="secondary">
              Open Billing
            </Link>
          }
        />
      ) : error ? (
        <LoadError
          title="Reports couldn't load"
          description={error}
          onRetry={() => {
            setError(null);
            setLoading(true);
            fetchReports();
          }}
        />
      ) : (
        <DataTable
          caption="Reports"
          columns={columns}
          rows={reports}
          rowKey={(r) => r.id}
          loading={loading}
          skeletonRows={6}
          empty={
            <NoResults
              icon={<BarChart3 size={32} strokeWidth={1.75} />}
              title="No reports yet"
              description="Create a report with New report to share a campaign's results."
            />
          }
        />
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        icon={FilePlus2}
        tone="brand"
        title="New report"
        description="Name the report. It starts private; you can make it public from the list."
        size="sm"
        dismissible={false}
        footer={
          <div className="cc-modal-footer">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              loading={creating}
              disabled={!title.trim()}
              onClick={() => {
                document.getElementById("report-form")?.dispatchEvent(
                  new Event("submit", { cancelable: true, bubbles: true })
                );
              }}
            >
              Create report
            </Button>
          </div>
        }
      >
        <form onSubmit={createReport} id="report-form" noValidate>
          <Field label="Title" required>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Q1 campaign report"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
