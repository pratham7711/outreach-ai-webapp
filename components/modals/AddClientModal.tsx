"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Input } from "@pratham7711/ui";
import { Button } from "@/components/ds";

export default function AddClientModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  /* Every non-ok response used to be dropped -- `if (res.ok)` and no else -- so
     a rejected logo URL or an expired session left the button doing nothing. */
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    logoUrl: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const contact = {
        ...(form.email.trim() && { email: form.email.trim() }),
        ...(form.phone.trim() && { phone: form.phone.trim() }),
      };
      /* Omitted rather than sent, when both fields are blank. This used to
         stringify the empty object and store the literal "{}" on every client
         added without contact details -- present, non-null, and meaning
         nothing, so "has contact info" was true for all of them. */
      const contactInfo = Object.keys(contact).length > 0 ? JSON.stringify(contact) : undefined;
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          logoUrl: form.logoUrl.trim() || undefined,
          contactInfo,
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
            : "Could not add that client.")
      );
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Add Client"
      size="md"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => { document.getElementById("add-client-form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); }}>
            Add Client
          </Button>
        </div>
      }
    >
      <form id="add-client-form" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
          label="Company Name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="e.g. Sony Music"
          required
        />
        <Input
          label="Contact Email"
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          placeholder="contact@company.com"
        />
        <Input
          label="Contact Phone"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          placeholder="+1 (555) 000-0000"
        />
        <Input
          label="Logo URL (optional)"
          value={form.logoUrl}
          onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
          placeholder="https://..."
        />
      </form>
    </Modal>
  );
}
