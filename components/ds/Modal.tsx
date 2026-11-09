"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, X } from "lucide-react";
import { FOCUSABLE, useDialogFocus } from "./useDialogFocus";

/**
 * The app's dialog. Every modal used to be `Modal` from @pratham7711/ui, which
 * drew a title-only header on a grey box with a text "×". This one keeps that
 * API -- open, onClose, title, size, footer, hideClose, children -- so a modal
 * moves over by changing its import, and adds what the old one had no room for:
 *
 *   icon + tone   a featured icon above the title, tinted by intent -- drawn
 *                 only for danger, warning and success. On a plain form the
 *                 disc said nothing and pushed the first field down, so a
 *                 brand, neutral or info dialog keeps its icon prop (the
 *                 intent stays written down) and draws no disc.
 *   description   one line under the title saying what the dialog is for
 *   align         "center" stacks the header and stretches the footer buttons,
 *                 for confirmations; "start" (default) for forms and settings
 *
 * It stays mounted through a short exit animation when `open` turns false.
 * Focus, the Tab trap, Escape and the scroll lock come from useDialogFocus,
 * which FilterDrawer shares: only the topmost open layer answers Escape.
 */

export type ModalTone = "brand" | "neutral" | "success" | "warning" | "danger" | "info";
export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ElementType;
  tone?: ModalTone;
  size?: ModalSize;
  align?: "start" | "center";
  footer?: React.ReactNode;
  hideClose?: boolean;
  /** Backdrop click closes. Off for dialogs holding unsaved input you would hate to lose. */
  dismissible?: boolean;
  /** Names the dialog when there is no visible title. */
  "aria-label"?: string;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
};

const ICON_TONES = new Set<ModalTone>(["danger", "warning", "success"]);

const EXIT_MS = 160;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Modal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  tone = "brand",
  size = "md",
  align = "start",
  footer,
  hideClose = false,
  dismissible = true,
  className,
  bodyClassName,
  children,
  ...rest
}: ModalProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descId = `${id}-desc`;
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const [mounted, setMounted] = useState(open);
  const state = open ? "open" : "closed";
  const [scroll, setScroll] = useState({ top: true, bottom: true });

  /* Mount on open, during render so the panel exists in the same commit; on
     close play the exit, then unmount. */
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return;
    const t = window.setTimeout(() => setMounted(false), reducedMotion() ? 0 : EXIT_MS);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  /* Stack membership, scroll lock and focus, for as long as the dialog is open:
     the autofocus target, else the body's first control, else the footer's
     first enabled button, else the panel. */
  const trapTab = useDialogFocus({
    open,
    panelRef,
    onClose,
    initialFocus: (panel) =>
      panel.querySelector<HTMLElement>("[autofocus],[data-autofocus]") ??
      bodyRef.current?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel.querySelector<HTMLElement>(".cc-dialog__footer " + FOCUSABLE.split(",")[1]),
  });

  /* Dividers above and below the body appear only while content is scrolled
     out of sight in that direction, so a short dialog stays one clean sheet. */
  const measure = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const top = el.scrollTop <= 1;
    const bottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
    setScroll((s) => (s.top === top && s.bottom === bottom ? s : { top, bottom }));
  }, []);
  useEffect(() => {
    if (!mounted) return;
    const el = bodyRef.current;
    if (!el) return;
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [mounted, measure]);

  if (!mounted || typeof document === "undefined") return null;

  const ShownIcon = Icon && ICON_TONES.has(tone) ? Icon : undefined;
  const hasHeader = Boolean(title || description || ShownIcon);
  const label = rest["aria-label"] ?? (typeof title === "string" ? title : undefined);

  return createPortal(
    <div
      className="cc-dialog-backdrop"
      data-state={state}
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : label}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`cc-dialog${className ? ` ${className}` : ""}`}
        data-size={size}
        data-align={align}
        data-state={state}
        data-scroll-top={scroll.top}
        data-scroll-bottom={scroll.bottom}
        onKeyDown={trapTab}
      >
        {hasHeader && (
          <header className="cc-dialog__header">
            {ShownIcon && (
              <span className="cc-dialog__icon" data-tone={tone} aria-hidden="true">
                <ShownIcon size={22} strokeWidth={1.9} />
              </span>
            )}
            {(title || description) && (
              <div className="cc-dialog__titles">
                {title && <h2 id={titleId} className="cc-dialog__title">{title}</h2>}
                {description && <p id={descId} className="cc-dialog__desc">{description}</p>}
              </div>
            )}
          </header>
        )}
        {!hideClose && (
          <button type="button" className="cc-dialog__close" onClick={onClose} aria-label="Close dialog">
            <X size={18} aria-hidden="true" />
          </button>
        )}
        <div
          ref={bodyRef}
          className={`cc-dialog__body${bodyClassName ? ` ${bodyClassName}` : ""}`}
          data-headless={!hasHeader}
          onScroll={measure}
        >
          {children}
        </div>
        {footer && <footer className="cc-dialog__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ── Body parts ────────────────────────────────────────────────────────────
   Small, shared pieces so a dialog body is built from rows and sections
   instead of paragraphs and inline styles. */

/** A titled group inside a dialog body. */
export function ModalSection({
  title,
  description,
  aside,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="cc-dialog-section">
      {(title || description || aside) && (
        <div className="cc-dialog-section__head">
          <div>
            {title && <h3 className="cc-dialog-section__title">{title}</h3>}
            {description && <p className="cc-dialog-section__desc">{description}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * One setting: an icon tile, a title, a line of explanation, and the control
 * that changes it at the end of the row. The whole row is the control's label,
 * so the text is clickable too.
 */
export function ModalOption({
  icon: Icon,
  title,
  description,
  control,
  disabled,
  as = "label",
}: {
  icon?: React.ElementType;
  title: React.ReactNode;
  description?: React.ReactNode;
  control?: React.ReactNode;
  disabled?: boolean;
  as?: "label" | "div";
}) {
  const Tag = as;
  return (
    <Tag className="cc-dialog-option" data-disabled={disabled || undefined}>
      {Icon && (
        <span className="cc-dialog-option__icon" aria-hidden="true">
          <Icon size={18} strokeWidth={1.9} />
        </span>
      )}
      <span className="cc-dialog-option__text">
        <span className="cc-dialog-option__title">{title}</span>
        {description && <span className="cc-dialog-option__desc">{description}</span>}
      </span>
      {control && <span className="cc-dialog-option__control">{control}</span>}
    </Tag>
  );
}

/** A list of ModalOptions inside one bordered box, divided by hairlines. */
export function ModalOptionList({ children }: { children: React.ReactNode }) {
  return <div className="cc-dialog-options">{children}</div>;
}

/** A tinted note: what will happen, what cannot be undone, what went wrong. */
export function ModalNotice({
  tone = "neutral",
  icon: Icon,
  title,
  children,
  action,
}: {
  tone?: ModalTone;
  icon?: React.ElementType;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="cc-dialog-notice" data-tone={tone} role={tone === "danger" ? "alert" : undefined}>
      {Icon && <Icon size={18} strokeWidth={1.9} className="cc-dialog-notice__icon" aria-hidden="true" />}
      <div className="cc-dialog-notice__text">
        {title && <div className="cc-dialog-notice__title">{title}</div>}
        {children && <div className="cc-dialog-notice__body">{children}</div>}
      </div>
      {action && <div className="cc-dialog-notice__action">{action}</div>}
    </div>
  );
}

/** A read-only value with a copy button that confirms itself. */
export function CopyField({
  value,
  label = "Copy",
  onCopied,
  onError,
  icon: Icon,
  autoFocus,
}: {
  value: string;
  label?: string;
  onCopied?: () => void;
  onError?: () => void;
  icon?: React.ElementType;
  /** Focus the Copy button when the dialog opens, rather than the field, so the
      URL is not shown selected and ringed before anyone has touched it. */
  autoFocus?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.();
    } catch {
      onError?.();
    }
  };
  return (
    <div className="cc-copy-field" data-copied={copied}>
      {Icon && <Icon size={16} className="cc-copy-field__icon" aria-hidden="true" />}
      <input
        type="text"
        readOnly
        value={value}
        aria-label="Link"
        onFocus={(e) => e.currentTarget.select()}
        className="cc-copy-field__input"
      />
      <button type="button" className="cc-copy-field__btn" onClick={copy} data-autofocus={autoFocus || undefined}>
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        <span aria-live="polite">{copied ? "Copied" : label}</span>
      </button>
    </div>
  );
}
