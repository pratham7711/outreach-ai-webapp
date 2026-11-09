"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Button } from "./Button";
import { Modal } from "./Modal";
import { AlertTriangle, CircleHelp, Trash2, type LucideIcon } from "lucide-react";

export type ConfirmVerb = "delete" | "remove";

type ConfirmBase = {
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  /** Overrides the tone's icon. */
  icon?: LucideIcon;
};

/**
 * Either a written `title`, or a `verb` and the `subject` it acts on:
 *
 *   confirm({ verb: "delete", subject: list.name })
 *
 * reads `Delete "Summer drop"?` over "This can't be undone.", with a trash
 * glyph and a Delete button -- one wording for every delete and remove in the
 * app. Anything passed explicitly (title, description, confirmLabel, icon)
 * still wins.
 */
export type ConfirmOptions = ConfirmBase &
  (
    | { title: string; verb?: ConfirmVerb; subject?: string }
    | { title?: string; verb: ConfirmVerb; subject: string }
  );

const UNDO_NOTE = "This can't be undone.";
const capital = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

/** What the dialog draws for a set of options: the defaults filled in. */
export function resolveConfirm(o: ConfirmOptions) {
  const danger = (o.tone ?? "danger") === "danger";
  const Verb = o.verb ? capital(o.verb) : null;
  return {
    danger,
    title: o.title ?? (Verb ? `${Verb} "${o.subject}"?` : ""),
    description: o.description ?? (danger ? UNDO_NOTE : undefined),
    confirmLabel: o.confirmLabel ?? Verb ?? "Confirm",
    cancelLabel: o.cancelLabel ?? "Cancel",
    icon: o.icon ?? (o.verb ? Trash2 : danger ? AlertTriangle : CircleHelp),
  };
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) {
    throw new Error("useConfirm must be used inside a ConfirmProvider");
  }
  return confirm;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  /* What the dialog shows. Kept after `options` clears so the text does not
     blank out while the dialog plays its exit. */
  const [shown, setShown] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    resolverRef.current?.(false);
    resolverRef.current = null;
    setOptions(next);
    setShown(next);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOptions(null);
    resolve?.(value);
  }, []);

  const view = shown ? resolveConfirm(shown) : null;
  const danger = view?.danger ?? true;

  /* Centred, with an intent icon over the question and two equal buttons --
     the shape a confirmation has everywhere else, so the eye finds "Cancel"
     on the left without reading. The description stays the whole body: a
     confirmation that needs more than two sentences needs a real dialog.
     A destructive one opens on Cancel, so Enter or a stray Space keeps the
     data; a harmless one opens on its confirm button. */
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={options !== null}
        onClose={() => settle(false)}
        icon={view?.icon}
        tone={danger ? "danger" : "brand"}
        title={view?.title}
        description={view?.description}
        size="sm"
        align="center"
        hideClose
        footer={
          <div className="cc-modal-footer">
            <Button variant="secondary" size="sm" onClick={() => settle(false)} autoFocus={danger}>
              {view?.cancelLabel ?? "Cancel"}
            </Button>
            <Button
              variant={danger ? "danger" : "primary"}
              size="sm"
              onClick={() => settle(true)}
              autoFocus={!danger}
            >
              {view?.confirmLabel ?? "Confirm"}
            </Button>
          </div>
        }
      />
    </ConfirmContext.Provider>
  );
}
