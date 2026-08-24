"use client";

import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Modal } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { AlertTriangle } from "lucide-react";

export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
};

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
  const resolverRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    resolverRef.current?.(false);
    resolverRef.current = null;
    setOptions(next);
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

  const danger = (options?.tone ?? "danger") === "danger";

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options ? (
        <Modal
          open
          onClose={() => settle(false)}
          title={options.title}
          size="sm"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => settle(false)}>
                {options.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={danger ? "danger" : "primary"}
                size="sm"
                onClick={() => settle(true)}
                autoFocus
              >
                {options.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          }
        >
          <div className="flex items-start gap-3">
            {danger ? (
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <AlertTriangle aria-hidden="true" className="size-4 text-destructive" />
              </span>
            ) : null}
            <p className="text-sm leading-relaxed text-muted-foreground">
              {options.description ?? "This action cannot be undone."}
            </p>
          </div>
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
}
