"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { Button, useConfirm } from "@/components/ds";
import { Modal } from "@/components/ds/Modal";
import { formatDateAbs } from "@/lib/format";

/**
 * The roster's "Join link": the agency's one /join/<code> link. A creator who
 * signs up on the creator portal through it lands on this roster
 * (lib/portal/joinAgency.ts). Nothing is sent to anyone; the agency shares it
 * in its own bio, DMs or emails.
 */

type Status =
  | { active: false }
  | { active: true; url: string; createdAt: string; joinedCount: number; lastJoinedAt: string | null };

export function JoinLinkButton() {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/join-link", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) {
      setError(res?.status === 403 ? "Only people who can add creators can see the join link." : "Couldn't load the join link.");
      return;
    }
    setStatus((await res.json()) as Status);
  }, []);

  useEffect(() => {
    if (open && status === null) void load();
  }, [open, status, load]);

  const call = async (method: "POST" | "DELETE") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/join-link", { method });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as Status);
      setCopied(false);
    } catch {
      setError(method === "POST" ? "Couldn't make the link. Try again." : "Couldn't turn the link off. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remake = async () => {
    const ok = await confirm({
      title: "Make a new join link?",
      description: "The current link stops working. Creators already on the roster stay.",
      confirmLabel: "Make a new link",
      tone: "default",
    });
    if (ok) await call("POST");
  };

  const turnOff = async () => {
    const ok = await confirm({
      title: "Turn off the join link?",
      description: "Nobody new can join through it. Creators already on the roster stay.",
      confirmLabel: "Turn off",
    });
    if (ok) await call("DELETE");
  };

  const copy = async () => {
    if (!status?.active) return;
    try {
      await navigator.clipboard.writeText(status.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy your join link:", status.url);
    }
  };

  const joined =
    status?.active && status.joinedCount > 0
      ? `${status.joinedCount} ${status.joinedCount === 1 ? "creator has" : "creators have"} joined${status.lastJoinedAt ? `, last on ${formatDateAbs(status.lastJoinedAt)}` : ""}.`
      : status?.active
        ? `Made ${formatDateAbs(status.createdAt)}. Nobody has joined yet.`
        : null;

  return (
    <>
      <Button variant="secondary" size="sm" iconLeft={<Link2 size={15} />} onClick={() => setOpen(true)} data-testid="join-link-open">
        Join link
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Join link"
        description="Creators who sign up through it join your roster."
        footer={
          status?.active ? (
            <>
              <Button variant="ghost" size="sm" onClick={turnOff} disabled={busy}>
                Turn off
              </Button>
              <Button variant="secondary" size="sm" onClick={remake} loading={busy}>
                Make a new link
              </Button>
            </>
          ) : undefined
        }
      >
        {error && (
          <p role="alert" style={{ margin: "0 0 12px", fontSize: "var(--cc-t-13)", color: "var(--cc-danger-ink)" }}>
            {error}
          </p>
        )}
        {status === null && !error ? (
          <p style={{ margin: 0, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>Loading…</p>
        ) : status && !status.active ? (
          <Button variant="primary" size="sm" iconLeft={<Link2 size={15} />} onClick={() => call("POST")} loading={busy}>
            Make join link
          </Button>
        ) : status?.active ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
              <input
                readOnly
                aria-label="Join link"
                data-testid="join-link-url"
                value={status.url}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  flex: "1 1 260px",
                  minWidth: 0,
                  fontSize: "var(--cc-t-13)",
                  color: "var(--cc-text)",
                  background: "var(--cc-bg)",
                  border: "1px solid var(--cc-border)",
                  borderRadius: "var(--cc-r-control)",
                  padding: "8px 10px",
                }}
              />
              <Button variant="primary" size="sm" iconLeft={copied ? <Check size={15} /> : <Copy size={15} />} onClick={copy}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            {joined && <p style={{ margin: 0, fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>{joined}</p>}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
