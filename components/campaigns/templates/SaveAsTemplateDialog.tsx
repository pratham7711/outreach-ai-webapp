"use client";

import { useEffect, useState } from "react";
import { Input } from "@pratham7711/ui";
import {
  AlertCircle,
  BookmarkPlus,
  Building2,
  FileText,
  Info,
  Layers,
  ListChecks,
  StickyNote,
  UserCheck,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ds";
import { Modal, ModalNotice, ModalOption, ModalOptionList, ModalSection } from "@/components/ds/Modal";
import { Switch } from "@/components/ds/Switch";
import {
  APPROVAL_LABEL,
  TEMPLATE_DESCRIPTION_MAX,
  TEMPLATE_NAME_MAX,
  briefWords,
  describeRules,
  formatBudget,
  partsPresent,
  type CampaignSetup,
  type SetupPart,
} from "@/lib/campaigns/templates/payload";
import { fetchSetupSource, type SetupSourceResponse } from "./useStartFromSources";

/**
 * Save as template: this campaign's setup under a name, to start new
 * campaigns from. The list shows exactly what will be saved -- only the parts
 * this campaign has -- and each can be left out. What is saved is read by the
 * server from the campaign itself; this dialog sends only the name, the
 * description and the parts to leave out.
 */

type PartRow = { part: SetupPart; icon: LucideIcon; title: string; detail: string };

function partRows(setup: CampaignSetup, clientName: string | null): PartRow[] {
  const present = new Set(partsPresent(setup));
  const rows: PartRow[] = [];
  if (present.has("client")) {
    rows.push({ part: "client", icon: Building2, title: "Client", detail: clientName ?? "A client that has since been removed" });
  }
  if (present.has("budget") && setup.budget !== null) {
    rows.push({ part: "budget", icon: Wallet, title: "Budget", detail: formatBudget(setup.budget, setup.currency) });
  }
  if (present.has("approval") && setup.postApprovalMode) {
    rows.push({
      part: "approval",
      icon: setup.postApprovalMode === "AUTO_APPROVED" ? Zap : UserCheck,
      title: "Post approval",
      detail: APPROVAL_LABEL[setup.postApprovalMode],
    });
  }
  if (present.has("notes") && setup.notes) {
    const flat = setup.notes.replace(/\s+/g, " ").trim();
    rows.push({ part: "notes", icon: StickyNote, title: "Notes", detail: flat.length > 90 ? `${flat.slice(0, 89)}…` : flat });
  }
  if (present.has("brief")) {
    const words = briefWords(setup.brief);
    rows.push({ part: "brief", icon: FileText, title: "Creative brief", detail: `${words.toLocaleString("en-US")} ${words === 1 ? "word" : "words"}` });
  }
  if (present.has("rules")) {
    rows.push({ part: "rules", icon: ListChecks, title: "Rules", detail: describeRules(setup.rules) });
  }
  if (present.has("phases")) {
    rows.push({
      part: "phases",
      icon: Layers,
      title: setup.phases.length === 1 ? "1 phase" : `${setup.phases.length} phases`,
      detail: setup.phases
        .map((p) => (p.targetPosts !== null ? `${p.name} (${p.targetPosts} ${p.targetPosts === 1 ? "post" : "posts"})` : p.name))
        .join(" · "),
    });
  }
  return rows;
}

export function SaveAsTemplateDialog({
  campaignId,
  campaignTitle,
  initial,
  onClose,
}: {
  campaignId: string;
  campaignTitle: string;
  /** What the page already read, shown while a fresh copy loads. */
  initial?: SetupSourceResponse | null;
  onClose: () => void;
}) {
  const [source, setSource] = useState<SetupSourceResponse | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState(campaignTitle.slice(0, TEMPLATE_NAME_MAX));
  const [description, setDescription] = useState("");
  const [off, setOff] = useState<Partial<Record<SetupPart, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Read fresh on open: the brief or the rules may have changed since the
     page loaded, and the list has to say what will actually be saved. */
  useEffect(() => {
    let live = true;
    void fetchSetupSource("campaign", campaignId).then((read) => {
      if (!live) return;
      if (read.ok) setSource(read.source);
      else setLoadError(read.error);
    });
    return () => {
      live = false;
    };
  }, [campaignId]);

  const rows = source ? partRows(source.setup, source.clientName) : [];
  const chosen = rows.filter((r) => !off[r.part]);
  const canSave = name.trim().length > 0 && chosen.length > 0 && source !== null && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/campaign-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          name: name.trim(),
          description: description.trim() || null,
          include: Object.fromEntries(rows.map((r) => [r.part, !off[r.part]])),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? "Could not save the template.");
        return;
      }
      toast.success(`Saved "${body?.template?.name ?? name.trim()}" as a template`, {
        description: "Pick it under Start from when you create a campaign.",
      });
      onClose();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={BookmarkPlus}
      tone="brand"
      title="Save as template"
      description="Start new campaigns from this one's setup."
      size="md"
      footer={
        <div className="cc-modal-footer">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={!canSave}
            onClick={save}
            iconLeft={<BookmarkPlus size={16} aria-hidden="true" />}
          >
            Save template
          </Button>
        </div>
      }
    >
      <div className="cc-dialog-stack">
        {error && (
          <ModalNotice tone="danger" icon={AlertCircle}>
            {error}
          </ModalNotice>
        )}
        <Input
          label="Template name"
          value={name}
          maxLength={TEMPLATE_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Song launch, three waves"
          required
          data-autofocus
        />
        <div className="ui-input-root">
          <label htmlFor="tpl-description" className="ui-input-label">
            Description
          </label>
          <textarea
            id="tpl-description"
            className="ui-textarea"
            value={description}
            maxLength={TEMPLATE_DESCRIPTION_MAX}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="When to use it"
            rows={2}
            style={{ minHeight: 0 }}
          />
        </div>
      </div>

      <ModalSection
        title="What it saves"
        description={rows.length ? "Only what this campaign has. Switch off anything that shouldn't carry over." : undefined}
      >
        {loadError && !source ? (
          <ModalNotice tone="danger" icon={AlertCircle}>
            {loadError}
          </ModalNotice>
        ) : !source ? (
          <p className="cc-dialog-section__desc" role="status">Reading this campaign&rsquo;s setup…</p>
        ) : rows.length === 0 ? (
          <ModalNotice tone="neutral" icon={Info}>
            This campaign has no setup to save yet: no client, budget, notes, brief, rules or phases.
          </ModalNotice>
        ) : (
          <ModalOptionList>
            {rows.map((r) => (
              <ModalOption
                key={r.part}
                icon={r.icon}
                title={r.title}
                description={r.detail}
                control={
                  <Switch
                    checked={!off[r.part]}
                    aria-label={`Save ${r.title.toLowerCase()}`}
                    onChange={(on) => setOff((o) => ({ ...o, [r.part]: !on }))}
                  />
                }
              />
            ))}
          </ModalOptionList>
        )}
        {rows.length > 0 && chosen.length === 0 && (
          <p className="cc-dialog-section__desc">Switch on at least one part to save.</p>
        )}
      </ModalSection>

      <ModalSection>
        <ModalNotice tone="neutral" icon={Info}>
          Never saved: the title, sound links, picture, creators, posts, launch date, example posts and phase dates.
          Each new campaign gets its own.
        </ModalNotice>
      </ModalSection>
    </Modal>
  );
}
