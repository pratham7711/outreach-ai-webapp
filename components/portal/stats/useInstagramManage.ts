"use client";

import { useEffect, useState } from "react";

/* Whether the comment and Partnership Ads tools are on here: they need
   permissions requested only while Meta reviews them. Read once per page. */
let featuresPromise: Promise<{ comments: boolean; partnerAds: boolean }> | null = null;
export function useInstagramManage(instagram: boolean): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!instagram) return;
    featuresPromise ??= fetch("/api/portal/instagram/features", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { comments: false, partnerAds: false }))
      .catch(() => ({ comments: false, partnerAds: false }));
    let cancelled = false;
    featuresPromise.then((f) => {
      if (!cancelled) setOn(Boolean(f.comments || f.partnerAds));
    });
    return () => {
      cancelled = true;
    };
  }, [instagram]);
  return on;
}
