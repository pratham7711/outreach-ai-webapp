"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button, Modal, Input, Badge, EmptyState, Card, LoadingSpinner } from "@pratham7711/ui";

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

  async function deleteReport(id: string) {
    if (!confirm("Delete this report?")) return;
    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
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

  return (
    <div className="cc-page-content">
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Reports</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Create and share campaign reports</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setOpen(true)}>
          New Report
        </Button>
      </div>

      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <LoadingSpinner size={24} />
        </div>
      ) : featureDisabled ? (
        <Card variant="outlined" noPadding>
          <div style={{ padding: 24 }}>
            <EmptyState
              icon="🔒"
              title="Reports are disabled"
              description="Enable the reports feature in Billing to create and manage reports for this organization."
              action={
                <Link
                  href="/settings/billing"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "10px 16px",
                    borderRadius: 10,
                    background: "var(--cc-primary)",
                    color: "white",
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  Open Billing
                </Link>
              }
            />
          </div>
        </Card>
      ) : error ? (
        <Card variant="outlined" noPadding>
          <div style={{ padding: 24 }}>
            <EmptyState
              icon="⚠️"
              title="Reports couldn't load"
              description={error}
              action={
                <Button
                  variant="primary"
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    fetchReports();
                  }}
                >
                  Try Again
                </Button>
              }
            />
          </div>
        </Card>
      ) : reports.length === 0 ? (
        <EmptyState
          icon="📊"
          title="No reports yet"
          description="Create a report to get started"
          action={
            <Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setOpen(true)}>
              New Report
            </Button>
          }
        />
      ) : (
        <Card variant="outlined" noPadding>
          <table style={{ width: "100%", fontSize: 14, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--cc-hover-bg)" }}>
                {["Title", "Campaign", "Created", "Visibility", ""].map((h, i) => (
                  <th key={i} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "var(--cc-text-muted)", padding: "12px 20px", textAlign: "left", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="cc-table-row" style={{ borderTop: "1px solid var(--cc-border)" }}>
                  <td style={{ padding: "12px 20px", fontWeight: 500, color: "var(--cc-text)" }}>{r.title}</td>
                  <td style={{ padding: "12px 20px", color: "var(--cc-text-muted)" }}>{r.campaign?.title ?? "—"}</td>
                  <td style={{ padding: "12px 20px", color: "var(--cc-text-muted)" }}>{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: "12px 20px" }}>
                    <Badge
                      variant={r.isPublic ? "success" : "neutral"}
                      size="sm"
                      onClick={() => togglePublic(r)}
                      style={{ cursor: "pointer" }}
                    >
                      {r.isPublic ? "Public" : "Private"}
                    </Badge>
                  </td>
                  <td style={{ padding: "12px 20px", textAlign: "right" }}>
                    <Button variant="danger" size="sm" onClick={() => deleteReport(r.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create Report"
        size="md"
        footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={creating}
              onClick={() => {
                document.getElementById("report-form")?.dispatchEvent(
                  new Event("submit", { cancelable: true, bubbles: true })
                );
              }}
            >
              Create
            </Button>
          </div>
        }
      >
        <form onSubmit={createReport} id="report-form">
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Q1 Campaign Report"
            required
          />
        </form>
      </Modal>
    </div>
  );
}
