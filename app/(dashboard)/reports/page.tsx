"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);

  async function fetchReports() {
    const res = await fetch("/api/reports");
    if (res.ok) setReports(await res.json());
    setLoading(false);
  }

  useEffect(() => { fetchReports(); }, []);

  async function createReport(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (res.ok) {
      setTitle("");
      setOpen(false);
      await fetchReports();
    }
    setCreating(false);
  }

  async function togglePublic(report: Report) {
    await fetch(`/api/reports/${report.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: !report.isPublic }),
    });
    await fetchReports();
  }

  async function deleteReport(id: string) {
    if (!confirm("Delete this report?")) return;
    await fetch(`/api/reports/${id}`, { method: "DELETE" });
    await fetchReports();
  }

  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Reports</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Create and share campaign reports</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button />}>New Report</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Report</DialogTitle>
            </DialogHeader>
            <form onSubmit={createReport} className="space-y-4 mt-2">
              <div className="space-y-1">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Q1 Campaign Report"
                  required
                />
              </div>
              <Button type="submit" disabled={creating} className="w-full">
                {creating ? "Creating..." : "Create"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Loading...</p>
      ) : reports.length === 0 ? (
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>No reports yet. Create one to get started.</p>
      ) : (
        <div style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden" }}>
          <table className="w-full" style={{ fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#F9FAFB" }}>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Title</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Campaign</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Created</th>
                <th style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", color: "#9097B4", padding: "12px 20px", textAlign: "left", letterSpacing: "0.5px" }}>Visibility</th>
                <th style={{ padding: "12px 20px" }}></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid var(--cc-border)" }}>
                  <td style={{ padding: "12px 20px", fontWeight: 500, color: "var(--cc-text)" }}>{r.title}</td>
                  <td style={{ padding: "12px 20px", color: "var(--cc-text-muted)" }}>
                    {r.campaign?.title ?? "—"}
                  </td>
                  <td style={{ padding: "12px 20px", color: "var(--cc-text-muted)" }}>
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td style={{ padding: "12px 20px" }}>
                    <button
                      onClick={() => togglePublic(r)}
                      style={{
                        fontSize: 12, padding: "4px 8px", borderRadius: 9999, fontWeight: 500, border: "none", cursor: "pointer",
                        background: r.isPublic ? "#dcfce7" : "#F3F4F6",
                        color: r.isPublic ? "#16a34a" : "var(--cc-text-muted)",
                      }}
                    >
                      {r.isPublic ? "Public" : "Private"}
                    </button>
                  </td>
                  <td style={{ padding: "12px 20px", textAlign: "right" }}>
                    <button
                      onClick={() => deleteReport(r.id)}
                      style={{ fontSize: 12, color: "#ef4444", background: "none", border: "none", cursor: "pointer" }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
