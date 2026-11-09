"use client";

import { useState, useEffect, useCallback } from "react";
import { BookOpen, Key, KeyRound, Plus, Trash2, Copy, Check } from "lucide-react";
import { PageHeader } from "@/components/ds";
import { Banner } from "@/components/ds/Banner";
import { Button } from "@/components/ds/Button";
import { DataTable, type DataTableColumn } from "@/components/ds/DataTable";
import { Field } from "@/components/ds/Field";
import { LoadError } from "@/components/ds/LoadError";
import { MoreMenu } from "@/components/ds/MoreMenu";
import { NoResults } from "@/components/ds/NoResults";
import { SectionCard } from "@/components/ds/SectionCard";
import { Input } from "@pratham7711/ui";
import { Modal } from "@/components/ds/Modal";
import { toast } from "sonner";
import { action } from "@/lib/ui/actions";
import { BRAND } from "@/lib/brand";
import { PAYOUTS_ENABLED } from "@/lib/payouts/switch";

interface ApiKeyItem {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function ApiKeysClient() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  /* Three states, not two. A failed or refused load left `keys` at [] and the
     page said "No API keys yet" — which is a claim about the org's keys, and
     it was being made on no evidence at all. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  /* The real origin, so what is printed below can be pasted as it stands. The
     server render has no window and BRAND.url is the same host in production,
     so the placeholder these snippets used to carry ("your-domain.com") was
     never anything but a step the reader had to get right themselves. */
  const [origin, setOrigin] = useState(BRAND.url);
  useEffect(() => setOrigin(window.location.origin), []);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/keys");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error ??
            (res.status === 403
              ? "You do not have permission to view this organization's API keys."
              : `Could not load API keys (${res.status}).`)
        );
      }
      const data = await res.json();
      setKeys(Array.isArray(data?.keys) ? data.keys : []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load API keys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const handleCreate = async () => {
    if (!newName.trim() || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedKey(data.key);
        setNewName("");
        fetchKeys();
      } else {
        toast.error("Couldn't create that key. Nothing was issued.");
      }
    } catch {
      toast.error("The request didn't go through. No key was issued.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      // The row used to be dropped whatever came back, so a failed revoke left
      // a live key that the screen said was gone.
      const res = await fetch(`/api/keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        setKeys((prev) => prev.filter((k) => k.id !== id));
      } else {
        toast.error("Couldn't revoke that key. It is still active.");
      }
    } catch {
      toast.error("The request didn't go through. The key is still active.");
    } finally {
      setRevoking(null);
      setConfirmRevoke(null);
    }
  };

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      // Named, so the server render and the browser's cannot land on different
      // days for a key created near midnight. See lib/format.
      timeZone: "UTC",
    });

  const openCreate = () => {
    setShowCreate(true);
    setCreatedKey(null);
    setCopied(false);
  };

  const revokeTarget = keys.find((k) => k.id === confirmRevoke) ?? null;

  const columns: DataTableColumn<ApiKeyItem>[] = [
    {
      key: "name",
      header: "Name",
      minWidth: 220,
      primary: true,
      render: (k) => (
        <span className="cc-api-key-name">
          <Key size={16} aria-hidden="true" />
          <span className="cc-dt-truncate">{k.name}</span>
        </span>
      ),
    },
    { key: "created", header: "Created", width: 140, render: (k) => formatDate(k.createdAt) },
    { key: "used", header: "Last used", width: 140, render: (k) => (k.lastUsedAt ? formatDate(k.lastUsedAt) : "Never") },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      width: 64,
      align: "right",
      render: (k) => (
        <MoreMenu
          size="sm"
          label={`Actions for ${k.name}`}
          items={[{ label: "Revoke key", icon: <Trash2 size={16} />, danger: true, onClick: () => setConfirmRevoke(k.id) }]}
        />
      ),
    },
  ];

  const snippets: { label: string; aria: string; code: string }[] = [
    {
      label: "REST / cURL",
      aria: "REST and cURL example",
      code: `curl -H "Authorization: Bearer oai_YOUR_KEY_HERE" \\
  ${origin}/api/campaigns`,
    },
    {
      label: "MCP server: Claude Code",
      aria: "Claude Code MCP example",
      code: `claude mcp add --transport http campaigns \\
  ${origin}/api/mcp \\
  --header "Authorization: Bearer oai_YOUR_KEY_HERE"`,
    },
    {
      label: "MCP server: any other client",
      aria: "MCP client example",
      code: `{
  "mcpServers": {
    "campaigns": {
      "type": "http",
      "url": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer oai_YOUR_KEY_HERE"
      }
    }
  }
}`,
    },
  ];

  return (
    <div className="rsp-page page-enter cc-api-keys">
      <PageHeader
        title="API keys"
        subtitle="Keys let scripts and AI clients reach this organization's data."
        actions={
          <Button variant="primary" size="sm" iconLeft={<Plus size={16} />} onClick={openCreate} {...action("create-api-key")}>
            Create API key
          </Button>
        }
      />

      {createdKey && (
        <Banner tone="warning" title="Save this key now. It won't be shown again." className="cc-api-key-created">
          <span className="cc-api-key-reveal">
            <code className="cc-api-key-reveal__code">{createdKey}</code>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={copied ? <Check size={14} /> : <Copy size={14} />}
              onClick={() => handleCopy(createdKey)}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </span>
        </Banner>
      )}

      <Modal
        open={showCreate && !createdKey}
        onClose={() => setShowCreate(false)}
        icon={KeyRound}
        title="Create API key"
        description="Name it after the system that will use it. The key is shown once, right after you create it."
        size="sm"
        dismissible={false}
        footer={
          <div className="cc-modal-footer">
            <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              form="cc-create-api-key"
              disabled={!newName.trim() || creating}
            >
              {creating ? "Creating…" : "Create key"}
            </Button>
          </div>
        }
      >
        <form
          id="cc-create-api-key"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <Field label="Key name" required>
            <Input
              id="cc-api-key-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Production backend"
              autoComplete="off"
              autoFocus
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={confirmRevoke !== null}
        onClose={() => setConfirmRevoke(null)}
        icon={Trash2}
        tone="danger"
        title={revokeTarget ? `Revoke "${revokeTarget.name}"?` : "Revoke this key?"}
        description="Any system using this key loses access immediately. This can't be undone."
        size="sm"
        align="center"
        hideClose
        footer={
          <div className="cc-modal-footer">
            <Button variant="secondary" size="sm" onClick={() => setConfirmRevoke(null)} autoFocus>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => confirmRevoke && handleRevoke(confirmRevoke)}
              disabled={revoking !== null && revoking === confirmRevoke}
            >
              {revoking !== null && revoking === confirmRevoke ? "Revoking…" : "Revoke key"}
            </Button>
          </div>
        }
      />

      <div className="cc-api-keys-stack">
        {loadError ? (
          <LoadError
            title="Could not load your API keys"
            description={`${loadError} This is not the same as having none: nothing has been revoked or lost.`}
            onRetry={() => void fetchKeys()}
            retrying={loading}
          />
        ) : (
          <SectionCard icon={Key} title="Keys" padded={false}>
            <DataTable
              bare
              caption="API keys"
              columns={columns}
              rows={keys}
              rowKey={(k) => k.id}
              loading={loading}
              skeletonRows={2}
              empty={
                <div className="cc-api-keys-empty">
                  <NoResults
                    icon={<Key size={32} strokeWidth={1.75} />}
                    title="No API keys yet"
                    description="Create a key to reach this organization from a script or an AI client."
                  />
                  <Button variant="secondary" size="sm" iconLeft={<Plus size={14} />} onClick={openCreate}>
                    Create your first key
                  </Button>
                </div>
              }
            />
          </SectionCard>
        )}

        <SectionCard
          icon={BookOpen}
          title="How to use your API key"
          description="Pass the key in the Authorization header of any API request."
        >
          <div className="cc-api-docs">
            {snippets.map((sn) => (
              <div key={sn.label} className="cc-api-docs__snippet">
                <p className="cc-microlabel">{sn.label}</p>
                <div tabIndex={0} role="region" aria-label={sn.aria} className="cc-code-block">
                  <code>{sn.code}</code>
                </div>
              </div>
            ))}
            <Banner tone="info" placement="inline" icon={false}>
              The MCP server gives an AI client read access to campaigns, posts, creators{PAYOUTS_ENABLED ? ", activations and payouts" : " and activations"}, and lets it refresh a campaign&apos;s metrics under the same 30-minute limit as the Refresh Data button. A key carries the whole organisation, so revoke it here the moment a client no longer needs it.
            </Banner>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
