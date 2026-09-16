"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";

/**
 * Says whose workspace this is, on every page, while an operator is in it.
 *
 * Not dismissible and not subtle on purpose. Everything else on the screen
 * belongs to somebody else's agency, and the one mistake this feature makes
 * possible is forgetting that -- editing a customer's campaign in the belief it
 * is your own. A banner that can be closed is a banner that is closed on the
 * first page and absent on the twentieth.
 *
 * Read-only and full access are named rather than implied: they are different
 * risks, and "which am I in" must not be something to infer from whether a
 * button is greyed out.
 */
export function ActingAsBanner({
  orgName,
  mode,
}: {
  orgName: string;
  mode: "read" | "full";
}) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    setLeaving(true);
    try {
      await fetch("/api/platform/act-as", { method: "DELETE" });
      /* Straight to the operator's own campaigns rather than refreshing in
         place: the page being viewed belongs to the tenant, and reloading it
         after the switch is dropped would 404 or, worse, silently show the same
         path inside the operator's own org. */
      router.push("/campaigns");
      router.refresh();
    } catch {
      setLeaving(false);
    }
  }

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        padding: "10px 20px",
        background: mode === "full" ? "#FEE2E2" : "#E0E7FF",
        borderBottom: "1px solid var(--cc-border)",
        fontSize: "var(--cc-t-13)",
        color: mode === "full" ? "#991B1B" : "#3730A3",
      }}
    >
      <Building2 size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
      <span>
        You are in <strong>{orgName}</strong> as platform staff —{" "}
        {mode === "full" ? "full access, your changes are theirs" : "read-only"}.
      </span>
      <button
        type="button"
        onClick={leave}
        disabled={leaving}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          fontWeight: "var(--cc-fw-strong)",
          color: "inherit",
          textDecoration: "underline",
          cursor: leaving ? "default" : "pointer",
          marginLeft: "auto",
        }}
      >
        {leaving ? "Leaving…" : "Return to my workspace"}
      </button>
    </div>
  );
}
