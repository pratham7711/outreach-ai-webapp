"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Input } from "@pratham7711/ui";
import { Dropdown, Button } from "@/components/ds";
import { parseCountInput } from "@/lib/format";

export default function AddCreatorModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  /* The route answers 409 on a duplicate handle, 400 with zod details on a bad
     field and 401 when the session has gone. All three used to be dropped on
     the floor -- `if (res.ok)` and no else -- so the button looked broken. */
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ followersCount?: string; averageViews?: string }>({});
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
    if (loading) return;

    const followers = parseCountInput(form.followersCount);
    const views = parseCountInput(form.averageViews);
    if (!followers.ok || !views.ok) {
      setFieldErrors({
        ...(followers.ok ? {} : { followersCount: followers.error }),
        ...(views.ok ? {} : { averageViews: views.error }),
      });
      setError(null);
      return;
    }
    setFieldErrors({});

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/creators", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          handle: form.handle,
          platform: form.platform,
          followersCount: followers.value,
          averageViews: views.value,
          rate: form.rate ? Number(form.rate) : undefined,
        }),
      });
      if (res.ok) {
        router.refresh();
        onClose();
        return;
      }
      const body = await res.json().catch(() => null);
      setError(
        body?.error ??
          (res.status === 401
            ? "Your session has expired. Sign in again and retry."
            : "Could not add that creator.")
      );
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
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
        {error && (
          <div
            role="alert"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "color-mix(in srgb, var(--cc-danger) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--cc-danger) 30%, transparent)",
              color: "var(--cc-danger)",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
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
          <label htmlFor="creator-platform" style={labelStyle}>Platform</label>
          <Dropdown
            ariaLabel="Platform"
            align="left"
            fullWidth
            value={form.platform}
            onChange={(v) => setForm((f) => ({ ...f, platform: v }))}
            options={[
              { value: "INSTAGRAM", label: "Instagram" },
              { value: "TIKTOK", label: "TikTok" },
              { value: "YOUTUBE", label: "YouTube" },
              { value: "TWITTER", label: "Twitter / X" },
            ]}
          />
        </div>
        {/* Text, not type="number": these get pasted straight off a profile
            page as "2.4M" or "1,200,000", both of which a number input simply
            refuses to hold. parseCountInput turns them into the integer the
            route wants. */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Follower Count"
              inputMode="numeric"
              value={form.followersCount}
              onChange={(e) => setForm((f) => ({ ...f, followersCount: e.target.value }))}
              placeholder="e.g. 2.4m"
              aria-invalid={Boolean(fieldErrors.followersCount)}
            />
            {fieldErrors.followersCount && (
              <p role="alert" style={{ fontSize: 12, color: "var(--cc-danger)", margin: "6px 0 0" }}>
                {fieldErrors.followersCount}
              </p>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <Input
              label="Avg Views"
              inputMode="numeric"
              value={form.averageViews}
              onChange={(e) => setForm((f) => ({ ...f, averageViews: e.target.value }))}
              placeholder="e.g. 500k"
              aria-invalid={Boolean(fieldErrors.averageViews)}
            />
            {fieldErrors.averageViews && (
              <p role="alert" style={{ fontSize: 12, color: "var(--cc-danger)", margin: "6px 0 0" }}>
                {fieldErrors.averageViews}
              </p>
            )}
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
