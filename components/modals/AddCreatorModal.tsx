"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Button, Input } from "@pratham7711/ui";

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

  const selectStyle = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid var(--cc-border)",
    fontSize: 14,
    color: "var(--cc-text)",
    outline: "none",
    background: "white",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "block" as const,
    fontSize: 13,
    fontWeight: 600 as const,
    color: "var(--cc-text)",
    marginBottom: 6,
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Add Creator"
      size="md"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => { document.getElementById("add-creator-form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); }}>
            Add Creator
          </Button>
        </div>
      }
    >
      <form id="add-creator-form" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Input
          label="Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Blessing Jolie"
          required
        />
        <Input
          label="Handle"
          value={form.handle}
          onChange={(e) => setForm((f) => ({ ...f, handle: e.target.value }))}
          placeholder="@username"
          required
        />
        <div>
          <label style={labelStyle}>Platform</label>
          <select
            value={form.platform}
            onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
            style={selectStyle}
          >
            <option value="INSTAGRAM">Instagram</option>
            <option value="TIKTOK">TikTok</option>
            <option value="YOUTUBE">YouTube</option>
            <option value="TWITTER">Twitter / X</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Follower Count"
              type="number"
              value={form.followersCount}
              onChange={(e) => setForm((f) => ({ ...f, followersCount: e.target.value }))}
              placeholder="e.g. 2400000"
            />
          </div>
          <div style={{ flex: 1 }}>
            <Input
              label="Avg Views"
              type="number"
              value={form.averageViews}
              onChange={(e) => setForm((f) => ({ ...f, averageViews: e.target.value }))}
              placeholder="e.g. 500000"
            />
          </div>
        </div>
        <Input
          label="Rate per Post (USD)"
          type="number"
          value={form.rate}
          onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
          placeholder="e.g. 5000"
        />
      </form>
    </Modal>
  );
}
