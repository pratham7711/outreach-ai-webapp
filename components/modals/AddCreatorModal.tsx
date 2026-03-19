"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";

export default function AddCreatorModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    handle: "",
    platform: "INSTAGRAM",
    followersCount: "",
    averageViews: "",
    rate: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/creators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          handle: form.handle,
          platform: form.platform,
          followersCount: form.followersCount ? Number(form.followersCount) : undefined,
          averageViews: form.averageViews ? Number(form.averageViews) : undefined,
          rate: form.rate ? Number(form.rate) : undefined,
        }),
      });
      if (res.ok) {
        router.refresh();
        onClose();
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", outline: "none", boxSizing: "border-box" as const };
  const labelStyle = { fontSize: 12, fontWeight: 600 as const, color: "var(--cc-text)", display: "block" as const, marginBottom: 6 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "white", borderRadius: 16, padding: 32, width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>Add Creator</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)" }}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>Name *</label>
            <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Blessing Jolie" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Handle *</label>
            <input required value={form.handle} onChange={e => setForm(f => ({ ...f, handle: e.target.value }))}
              placeholder="@username" style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Platform</label>
            <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
              style={{ ...inputStyle, background: "white" }}>
              <option value="INSTAGRAM">Instagram</option>
              <option value="TIKTOK">TikTok</option>
              <option value="YOUTUBE">YouTube</option>
              <option value="TWITTER">Twitter / X</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Follower Count</label>
              <input type="number" value={form.followersCount} onChange={e => setForm(f => ({ ...f, followersCount: e.target.value }))}
                placeholder="e.g. 2400000" style={inputStyle} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Avg Views</label>
              <input type="number" value={form.averageViews} onChange={e => setForm(f => ({ ...f, averageViews: e.target.value }))}
                placeholder="e.g. 500000" style={inputStyle} />
            </div>
          </div>
          <div>
            <label style={labelStyle}>Rate per Post (USD)</label>
            <input type="number" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: e.target.value }))}
              placeholder="e.g. 5000" style={inputStyle} />
          </div>
          <button type="submit" disabled={loading}
            style={{ padding: "12px", borderRadius: 10, background: "var(--cc-primary)", color: "white", fontSize: 14, fontWeight: 600, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, marginTop: 8 }}>
            {loading ? "Adding..." : "Add Creator"}
          </button>
        </form>
      </div>
    </div>
  );
}
