"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import { Modal } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { capturePage } from "@/lib/feedback/capture";
import { installClientSignals, recentClientErrors, recentFailedRequests } from "@/lib/feedback/clientSignals";
import { MAX_MESSAGE_CHARS, type FeedbackSurface } from "@/lib/feedback/limits";

/**
 * The Feedback button on every page a client or creator uses.
 *
 * One press takes a screenshot of exactly what they are looking at -- before
 * the dialog opens, so the dialog is not in it -- and then asks what went wrong.
 * The message is optional; the screenshot always goes. With it go the page
 * address, the browser and window size, and the page's own recent errors and
 * failed requests, so a report of "this is broken" can be acted on without a
 * round of questions.
 */

const WIDGET_ATTR = "data-feedback-widget";
/* Scrolled this far, a phone shows the button as its icon alone. */
const COMPACT_AFTER_PX = 160;

type Phase =
  | { kind: "idle" }
  | { kind: "capturing" }
  | { kind: "form"; screenshot: string | null; captureError: string | null; context: PageContext }
  | { kind: "sending"; screenshot: string | null; captureError: string | null; context: PageContext }
  | { kind: "sent" };

function isWidget(node: Node): boolean {
  return node instanceof Element && node.hasAttribute(WIDGET_ATTR);
}

function currentTheme(): string {
  const cl = document.documentElement.classList;
  return ["dark", "creatorcore", "light"].find((t) => cl.contains(t)) ?? "unknown";
}

type PageContext = ReturnType<typeof pageContext>;

/* Read when Feedback is pressed, before the screenshot: taking it re-fetches
   every image on the page, and those requests are not what went wrong. */
function pageContext() {
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
    screen: { w: window.screen.width, h: window.screen.height },
    userAgent: navigator.userAgent,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    theme: currentTheme(),
    online: navigator.onLine,
    errors: recentClientErrors(),
    failedRequests: recentFailedRequests(),
  };
}

export function FeedbackButton({
  surface,
  linkToken,
  raiseOnPhone = false,
}: {
  surface: FeedbackSurface;
  /** The share or list link's token: on those pages it is who the feedback is from. */
  linkToken?: string;
  /** Lift the button above a phone tab bar (the creator portal's). */
  raiseOnPhone?: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrolled, setScrolled] = useState(false);

  /* The dashboard scrolls inside <main> and the public pages scroll the window,
     so listen in the capture phase for either. Scrollers too short to matter --
     a table sliding sideways, a dropdown -- are ignored. */
  useEffect(() => {
    const onScroll = (e: Event) => {
      const el = e.target instanceof Element ? e.target : document.scrollingElement;
      if (!el || el.scrollHeight - el.clientHeight < 400) return;
      setScrolled(el.scrollTop > COMPACT_AFTER_PX);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  useEffect(() => {
    installClientSignals();
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  const close = () => {
    if (phase.kind === "sending") return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setPhase({ kind: "idle" });
    setMessage("");
    setError(null);
  };

  const start = async () => {
    if (phase.kind !== "idle") return;
    setPhase({ kind: "capturing" });
    setError(null);
    const context = pageContext();
    const shot = await capturePage({ exclude: isWidget, shareToken: surface === "share" ? linkToken : undefined });
    setPhase(
      "dataUrl" in shot
        ? { kind: "form", screenshot: shot.dataUrl, captureError: null, context }
        : { kind: "form", screenshot: null, captureError: shot.error, context },
    );
  };

  const send = async () => {
    if (phase.kind !== "form") return;
    const { screenshot, captureError, context } = phase;
    setPhase({ kind: "sending", screenshot, captureError, context });
    setError(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface,
          linkToken,
          message: message.trim() || undefined,
          pageUrl: window.location.href,
          pageTitle: document.title || undefined,
          screenshot: screenshot ?? undefined,
          screenshotError: screenshot ? undefined : (captureError ?? "capture failed"),
          context,
        }),
      });
      if (!res.ok) {
        setError(
          res.status === 429
            ? "You've sent a lot of feedback in the last few minutes. Please try again in a little while."
            : res.status === 401
              ? "Your session has ended. Sign in again and resend."
              : "We couldn't send that. Please try again.",
        );
        setPhase({ kind: "form", screenshot, captureError, context });
        return;
      }
      setPhase({ kind: "sent" });
      setMessage("");
      closeTimer.current = setTimeout(() => setPhase({ kind: "idle" }), 2200);
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
      setPhase({ kind: "form", screenshot, captureError, context });
    }
  };

  const busy = phase.kind === "capturing";
  const open = phase.kind === "form" || phase.kind === "sending" || phase.kind === "sent";
  const shot = phase.kind === "form" || phase.kind === "sending" ? phase.screenshot : null;

  return (
    <>
      <button
        type="button"
        {...{ [WIDGET_ATTR]: "" }}
        className={["cc-feedback-fab", raiseOnPhone && "cc-feedback-fab-raised", scrolled && !busy && "cc-feedback-fab-compact"].filter(Boolean).join(" ")}
        onClick={start}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={busy ? "Capturing the page for feedback" : "Send feedback about this page"}
      >
        <MessageSquareWarning size={15} aria-hidden="true" />
        <span className="cc-feedback-fab-label">{busy ? "Capturing…" : "Feedback"}</span>
      </button>

      {open && (
        <Modal
          open
          onClose={close}
          title={phase.kind === "sent" ? "Feedback sent" : "Send feedback"}
          size="sm"
          footer={
            phase.kind === "sent" ? (
              <div className="cc-modal-footer">
                <Button variant="secondary" onClick={close}>
                  Close
                </Button>
              </div>
            ) : (
              <div className="cc-modal-footer">
                <Button variant="secondary" onClick={close} disabled={phase.kind === "sending"}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={send} loading={phase.kind === "sending"}>
                  Send feedback
                </Button>
              </div>
            )
          }
        >
          <div {...{ [WIDGET_ATTR]: "" }} className="cc-feedback-panel">
            {phase.kind === "sent" ? (
              <p role="status" className="cc-feedback-thanks">
                Thanks — we&rsquo;ve got it. We&rsquo;ll look at what you sent, along with a screenshot of the page.
              </p>
            ) : (
              <>
                {shot ? (
                  <figure className="cc-feedback-shot">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise */}
                    <img src={shot} alt="Screenshot of this page that will be sent with your feedback" />
                    <figcaption>A screenshot of this page is sent with your feedback.</figcaption>
                  </figure>
                ) : (
                  <p className="cc-feedback-note">
                    We couldn&rsquo;t capture a screenshot of this page. Your message is still sent, with the page
                    address and your browser details.
                  </p>
                )}
                <label className="cc-feedback-label" htmlFor="cc-feedback-message">
                  What went wrong? <span>(optional)</span>
                </label>
                <textarea
                  id="cc-feedback-message"
                  className="cc-feedback-input"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={MAX_MESSAGE_CHARS}
                  rows={4}
                  placeholder="e.g. The numbers on this campaign haven't updated since yesterday"
                  disabled={phase.kind === "sending"}
                  autoFocus
                />
                {error && (
                  <p role="alert" className="cc-feedback-error">
                    {error}
                  </p>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
