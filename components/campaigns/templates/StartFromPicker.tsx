"use client";

import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, Copy, FilePlus2, LayoutTemplate, Pencil, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ds";
import { TEMPLATE_NAME_MAX, summaryLine } from "@/lib/campaigns/templates/payload";
import type { PastCampaignRow, SourceKind, StartFromSources, TemplateRow } from "./useStartFromSources";

/**
 * "Start from" at the top of New Campaign: Blank, one of the org's templates,
 * or a past campaign's setup. A disclosure rather than a floating menu: it
 * opens in place inside the dialog's own scroll, so nothing is clipped by the
 * dialog body and the form below simply moves down while it is open.
 *
 * Templates can be renamed and deleted from here -- the one place they are
 * listed -- by whoever may create campaigns.
 */

export type StartFromChoice = { kind: SourceKind; id: string; name: string } | null;

/* Escape inside the picker closes the picker, not the whole form. The dialog
   listens for Escape on document; React's own listener sits on the root before
   it, so stopping the native event here keeps the dialog (and everything
   typed into it) open. */
function keepDialogOpen(e: KeyboardEvent) {
  e.preventDefault();
  e.nativeEvent.stopImmediatePropagation();
}

const rowButton: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "var(--cc-sp-5)",
  flex: "1 1 auto",
  minWidth: 0,
  padding: "var(--cc-sp-4) var(--cc-sp-5)",
  border: "none",
  borderRadius: "var(--cc-r-input)",
  background: "transparent",
  color: "var(--cc-text)",
  textAlign: "left",
  cursor: "pointer",
  font: "inherit",
};

const iconButton: CSSProperties = {
  flex: "none",
  display: "grid",
  placeItems: "center",
  width: 30,
  height: 30,
  border: "none",
  borderRadius: "var(--cc-r-input)",
  background: "transparent",
  color: "var(--cc-text-muted)",
  cursor: "pointer",
};

const muted: CSSProperties = { fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", lineHeight: 1.4 };

const ellipsis: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function OptionText({ title, detail }: { title: ReactNode; detail?: ReactNode }) {
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ ...ellipsis, fontSize: "var(--cc-t-14)", fontWeight: 500 }}>{title}</span>
      {detail ? <span style={{ ...muted, ...ellipsis }}>{detail}</span> : null}
    </span>
  );
}

function SelectedMark({ on }: { on: boolean }) {
  return (
    <Check
      size={15}
      aria-hidden="true"
      style={{ flex: "none", marginTop: 3, color: "var(--cc-primary)", opacity: on ? 1 : 0 }}
    />
  );
}

function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "var(--cc-sp-4) var(--cc-sp-5) var(--cc-sp-2)",
        fontSize: "var(--cc-t-12)",
        fontWeight: "var(--cc-fw-strong)",
        color: "var(--cc-text-muted)",
      }}
    >
      {children}
    </p>
  );
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function TemplateItem({
  template,
  selected,
  canManage,
  onPick,
  onRename,
  onRemove,
}: {
  template: TemplateRow;
  selected: boolean;
  canManage: boolean;
  onPick: () => void;
  onRename: (name: string) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(template.name);
  const [saving, setSaving] = useState(false);
  const readable = template.summary !== null;

  const save = async () => {
    const name = draft.trim();
    if (!name || name === template.name) {
      setEditing(false);
      setDraft(template.name);
      return;
    }
    setSaving(true);
    const ok = await onRename(name);
    setSaving(false);
    if (ok) setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: "var(--cc-sp-2)", padding: "var(--cc-sp-2) var(--cc-sp-3)" }}>
        <input
          className="ui-input ui-input-md"
          aria-label={`New name for ${template.name}`}
          value={draft}
          maxLength={TEMPLATE_NAME_MAX}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            } else if (e.key === "Escape") {
              keepDialogOpen(e);
              setEditing(false);
              setDraft(template.name);
            }
          }}
          style={{ flex: "1 1 auto", minWidth: 0 }}
        />
        <button type="button" style={iconButton} onClick={() => void save()} disabled={saving} aria-label="Save name" title="Save name">
          <Check size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          style={iconButton}
          onClick={() => {
            setEditing(false);
            setDraft(template.name);
          }}
          aria-label="Cancel rename"
          title="Cancel"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--cc-sp-1)", paddingRight: "var(--cc-sp-2)" }}>
      <button
        type="button"
        style={{ ...rowButton, cursor: readable ? "pointer" : "default", opacity: readable ? 1 : 0.6 }}
        onClick={readable ? onPick : undefined}
        disabled={!readable}
        aria-pressed={selected}
        data-testid="start-from-template"
      >
        <SelectedMark on={selected} />
        <OptionText
          title={template.name}
          detail={
            readable
              ? template.description || summaryLine(template.summary!, template.clientName)
              : "Saved by a newer version of the app"
          }
        />
      </button>
      {canManage && (
        <>
          <button
            type="button"
            style={iconButton}
            onClick={() => {
              setDraft(template.name);
              setEditing(true);
            }}
            aria-label={`Rename ${template.name}`}
            title="Rename"
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
          <button type="button" style={iconButton} onClick={onRemove} aria-label={`Delete ${template.name}`} title="Delete">
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </>
      )}
    </div>
  );
}

/** The open list. Its own component so useConfirm is only asked for while it is open. */
function SourceList({
  sources,
  choice,
  onPick,
  onBlank,
  onClose,
}: {
  sources: StartFromSources;
  choice: StartFromChoice;
  onPick: (kind: SourceKind, id: string, name: string) => void;
  onBlank: () => void;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const { templates, campaigns, query, canManage } = sources;
  const noMatch = query.trim() !== "" && !sources.searching && templates.length === 0 && campaigns.length === 0;

  const removeTemplate = async (t: TemplateRow) => {
    const ok = await confirm({
      verb: "delete",
      subject: t.name,
      description: "It leaves the Start from list for everyone in your workspace. Campaigns already started from it keep their setup.",
      confirmLabel: "Delete template",
    });
    if (!ok) return;
    const done = await sources.remove(t.id);
    if (!done.ok) {
      toast.error(done.error);
      return;
    }
    toast.success(`Deleted "${t.name}"`);
    if (choice?.kind === "template" && choice.id === t.id) onBlank();
  };

  const renameTemplate = async (t: TemplateRow, name: string) => {
    const done = await sources.rename(t.id, name);
    if (!done.ok) {
      toast.error(done.error);
      return false;
    }
    if (choice?.kind === "template" && choice.id === t.id) onPick("template", t.id, name);
    return true;
  };

  return (
    <div
      style={{
        border: "1px solid var(--cc-border)",
        borderRadius: "var(--cc-r-card)",
        background: "var(--cc-card)",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "relative", padding: "var(--cc-sp-4)", borderBottom: "1px solid var(--cc-border)" }}>
        <Search
          size={15}
          aria-hidden="true"
          style={{ position: "absolute", left: "calc(var(--cc-sp-4) + 12px)", top: "50%", transform: "translateY(-50%)", color: "var(--cc-text-muted)" }}
        />
        <input
          type="search"
          className="ui-input ui-input-md"
          aria-label="Search templates and campaigns"
          placeholder="Search templates and campaigns"
          value={query}
          autoFocus
          onChange={(e) => sources.search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              keepDialogOpen(e);
              onClose();
            }
          }}
          style={{ paddingLeft: 34 }}
        />
      </div>
      <div style={{ maxHeight: 280, overflowY: "auto", padding: "var(--cc-sp-2)" }} aria-busy={sources.searching}>
        <button type="button" style={rowButton} onClick={onBlank} aria-pressed={choice === null}>
          <SelectedMark on={choice === null} />
          <FilePlus2 size={16} aria-hidden="true" style={{ flex: "none", marginTop: 2, color: "var(--cc-text-muted)" }} />
          <OptionText title="Blank" detail="Empty fields, nothing copied" />
        </button>

        {templates.length > 0 && <GroupHeading>Your templates</GroupHeading>}
        {templates.map((t) => (
          <TemplateItem
            key={t.id}
            template={t}
            selected={choice?.kind === "template" && choice.id === t.id}
            canManage={canManage}
            onPick={() => onPick("template", t.id, t.name)}
            onRename={(name) => renameTemplate(t, name)}
            onRemove={() => void removeTemplate(t)}
          />
        ))}

        {campaigns.length > 0 && <GroupHeading>Copy a past campaign</GroupHeading>}
        {campaigns.map((c: PastCampaignRow) => (
          <button
            key={c.id}
            type="button"
            style={rowButton}
            onClick={() => onPick("campaign", c.id, c.title)}
            aria-pressed={choice?.kind === "campaign" && choice.id === c.id}
            data-testid="start-from-campaign"
          >
            <SelectedMark on={choice?.kind === "campaign" && choice.id === c.id} />
            <OptionText title={c.title} detail={[c.clientName, `Updated ${shortDate(c.updatedAt)}`].filter(Boolean).join(" · ")} />
          </button>
        ))}
        {sources.campaignsMore && (
          <p style={{ ...muted, margin: "var(--cc-sp-3) var(--cc-sp-5)" }}>
            {query.trim() ? "More campaigns match. Keep typing to narrow it down." : "Showing your most recent campaigns. Search to find an older one."}
          </p>
        )}
        {noMatch && (
          <p style={{ ...muted, margin: "var(--cc-sp-4) var(--cc-sp-5)" }}>No template or campaign is called anything like &ldquo;{query.trim()}&rdquo;.</p>
        )}
      </div>
    </div>
  );
}

export function StartFromPicker({
  sources,
  choice,
  busy,
  copies,
  error,
  onPick,
  onBlank,
  placeholder = false,
}: {
  sources: StartFromSources;
  choice: StartFromChoice;
  /** A choice is being read from the server. */
  busy: boolean;
  /** What else comes along, e.g. "the brief, 3 rules and 2 phases". Null when nothing does. */
  copies: string | null;
  error: string | null;
  onPick: (kind: SourceKind, id: string, name: string) => void;
  onBlank: () => void;
  /** Hold the row's space, unseen and unreachable, while the list loads, so the form below does not jump when it arrives. */
  placeholder?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const labelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);

  /* A closed list forgets its search, so it reopens on everything. */
  const toggle = (next: boolean) => {
    setOpen(next);
    if (!next && sources.query) sources.search("");
  };
  /* Back on the trigger once a choice closes the list, so the keyboard user
     carries on from the top of the form. */
  const close = () => {
    toggle(false);
    trigger.current?.focus();
  };

  const Icon = choice === null ? FilePlus2 : choice.kind === "template" ? LayoutTemplate : Copy;
  const kindLabel = choice === null ? null : choice.kind === "template" ? "Template" : "Copy of a past campaign";

  return (
    <div
      className="ui-input-root"
      {...(placeholder ? { "aria-hidden": true, inert: true, style: { visibility: "hidden" as const } } : { "data-testid": "start-from" })}
    >
      <span id={labelId} className="ui-input-label">Start from</span>
      <button
        ref={trigger}
        type="button"
        aria-labelledby={`${labelId} ${panelId}-value`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => toggle(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--cc-sp-5)",
          width: "100%",
          padding: "9px 14px",
          border: "1px solid var(--cc-border)",
          borderRadius: "var(--cc-r-input)",
          background: "var(--cc-card)",
          color: "var(--cc-text)",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <Icon size={16} aria-hidden="true" style={{ flex: "none", color: choice ? "var(--cc-primary)" : "var(--cc-text-muted)" }} />
        <span id={`${panelId}-value`} style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "baseline", gap: "var(--cc-sp-4)" }}>
          <span style={{ ...ellipsis, fontSize: "var(--cc-t-14)" }}>{choice ? choice.name : "Blank"}</span>
          {kindLabel && <span style={{ ...muted, flex: "none" }}>{kindLabel}</span>}
        </span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          style={{ flex: "none", color: "var(--cc-text-muted)", transform: open ? "rotate(180deg)" : undefined, transition: "transform 120ms ease" }}
        />
      </button>

      {open && (
        <div id={panelId} style={{ marginTop: "var(--cc-sp-2)" }}>
          <SourceList
            sources={sources}
            choice={choice}
            onClose={close}
            onBlank={() => {
              onBlank();
              close();
            }}
            onPick={(kind, id, name) => {
              onPick(kind, id, name);
              close();
            }}
          />
        </div>
      )}

      {!open && (busy || error || choice) && (
        <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "var(--cc-sp-1) var(--cc-sp-4)", marginTop: 2 }}>
          <span role="status" style={{ ...muted, color: error ? "var(--cc-danger)" : muted.color }}>
            {busy
              ? "Reading its setup…"
              : error
                ? error
                : copies
                  ? `Fills in the fields below and also copies ${copies}. Never creators, posts or links.`
                  : "Fills in the fields below. Never creators, posts or links."}
          </span>
          {choice && !busy && (
            <button
              type="button"
              onClick={onBlank}
              style={{
                border: "none",
                background: "none",
                padding: 0,
                font: "inherit",
                fontSize: "var(--cc-t-12)",
                fontWeight: "var(--cc-fw-strong)",
                color: "var(--cc-primary)",
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              Back to Blank
            </button>
          )}
        </div>
      )}
    </div>
  );
}
