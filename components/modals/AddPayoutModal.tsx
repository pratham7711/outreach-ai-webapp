"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@pratham7711/ui";
import { Modal, ModalNotice } from "@/components/ds/Modal";
import { AlertCircle, AlertTriangle, Wallet } from "lucide-react";
import { Dropdown, Button } from "@/components/ds";
import { Field, FieldRow } from "@/components/ds/Field";
import { creatorNameText } from "@/lib/creators/creatorName";

type Creator = { id: string; name: string; handle: string };
type Campaign = { id: string; title: string };

export default function AddPayoutModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  /* A rejected payout used to close nothing and say nothing (`if (res.ok)`
     with no else). */
  const [error, setError] = useState<string | null>(null);

  /* Fetched here rather than passed in: the payouts page was selecting every
     creator and campaign in the org to fill these two pickers, on every load,
     for a dialog most visits never open. */
  const [creators, setCreators] = useState<Creator[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [optionsState, setOptionsState] = useState<"loading" | "ready" | "failed">("loading");

  const loadOptions = useCallback(async () => {
    setOptionsState("loading");
    try {
      const res = await fetch("/api/payouts/options");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setCreators(data.creators ?? []);
      setCampaigns(data.campaigns ?? []);
      setOptionsState("ready");
    } catch {
      setOptionsState("failed");
    }
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);
  const [form, setForm] = useState({
    creatorId: "",
    campaignId: "",
    amount: "",
    currency: "USD",
    status: "PENDING",
  });

  const canSubmit = optionsState === "ready" && form.creatorId !== "" && form.amount.trim() !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: form.creatorId,
          campaignId: form.campaignId || undefined,
          amount: Number(form.amount),
          currency: form.currency,
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
            : "Could not record that payout.")
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
      icon={Wallet}
      tone="brand"
      title="New Payout"
      description="Record a payout to a creator, optionally against one of your campaigns."
      size="md"
      dismissible={false}
      footer={
        <div className="cc-modal-footer">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="add-payout-form"
            variant="primary"
            size="sm"
            loading={loading}
            disabled={!canSubmit}
          >
            New Payout
          </Button>
        </div>
      }
    >
      <form id="add-payout-form" onSubmit={handleSubmit} className="cc-dialog-stack" noValidate>
        {error && (
          <ModalNotice tone="danger" icon={AlertCircle}>
            {error}
          </ModalNotice>
        )}
        {optionsState === "failed" && (
          <ModalNotice
            tone="warning"
            icon={AlertTriangle}
            action={
              <Button variant="secondary" size="sm" onClick={loadOptions}>
                Retry
              </Button>
            }
          >
            Couldn&apos;t load creators and campaigns.
          </ModalNotice>
        )}
        <Field label="Creator" required>
          <Dropdown
            id="payout-creator"
            align="left"
            fullWidth
            disabled={optionsState !== "ready"}
            value={form.creatorId}
            onChange={(v) => setForm((f) => ({ ...f, creatorId: v }))}
            options={[
              {
                value: "",
                label:
                  optionsState === "loading"
                    ? "Loading creators..."
                    : optionsState === "failed"
                      ? "Creators unavailable"
                      : "Select creator...",
              },
              ...creators.map((c) => ({ value: c.id, label: creatorNameText(c.name, c.handle) })),
            ]}
          />
        </Field>
        <Field label="Campaign">
          <Dropdown
            id="payout-campaign"
            align="left"
            fullWidth
            disabled={optionsState !== "ready"}
            value={form.campaignId}
            onChange={(v) => setForm((f) => ({ ...f, campaignId: v }))}
            options={[
              { value: "", label: "No campaign" },
              ...campaigns.map((c) => ({ value: c.id, label: c.title })),
            ]}
          />
        </Field>
        <FieldRow>
          <Field label="Amount" required>
            <Input
              type="number"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="e.g. 5000"
            />
          </Field>
          <Field label="Currency">
            <Dropdown
              id="payout-currency"
              align="left"
              fullWidth
              value={form.currency}
              onChange={(v) => setForm((f) => ({ ...f, currency: v }))}
              options={["USD", "EUR", "GBP", "INR"].map((c) => ({ value: c, label: c }))}
            />
          </Field>
        </FieldRow>
      </form>
    </Modal>
  );
}
