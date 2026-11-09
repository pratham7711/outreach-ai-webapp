"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CampaignSetup, SetupSummary } from "@/lib/campaigns/templates/payload";

/**
 * What New Campaign can start from: the org's templates and its recent
 * campaigns (GET /api/campaign-templates). Loaded once when the form opens;
 * `available` stays what that first, unfiltered load said, so a search that
 * matches nothing does not make the Start from row vanish under the cursor.
 */

export type TemplateRow = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  /** Null for a template saved by a newer version: listed, so it can be deleted, but not offered. */
  summary: SetupSummary | null;
  clientName: string | null;
};

export type PastCampaignRow = {
  id: string;
  title: string;
  clientName: string | null;
  updatedAt: string;
};

export type SourceKind = "template" | "campaign";

/** GET /api/campaign-templates/source, for one starting point. */
export type SetupSourceResponse = {
  kind: SourceKind;
  id: string;
  name: string;
  setup: CampaignSetup;
  summary: SetupSummary;
  alsoCopies: string | null;
  clientName: string | null;
  canSave: boolean;
};

type ListResponse = {
  ready: boolean;
  canManage: boolean;
  templates: TemplateRow[];
  campaigns: PastCampaignRow[];
  campaignsMore: boolean;
};

export type StartFromSources = {
  status: "loading" | "ready" | "error";
  /** Whether the org has any template or any campaign to start from. */
  available: boolean;
  /** Whether this person may rename and delete templates. */
  canManage: boolean;
  query: string;
  searching: boolean;
  templates: TemplateRow[];
  campaigns: PastCampaignRow[];
  campaignsMore: boolean;
  search: (q: string) => void;
  rename: (id: string, name: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  remove: (id: string) => Promise<{ ok: true } | { ok: false; error: string }>;
};

const SEARCH_DELAY_MS = 200;

const listUrl = (q: string) => `/api/campaign-templates${q ? `?q=${encodeURIComponent(q)}` : ""}`;

async function readList(q: string): Promise<ListResponse> {
  const res = await fetch(listUrl(q));
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as ListResponse;
}

/* One unfiltered read started before the form mounts (hover or focus on
   New Campaign), handed to the next form that opens and then dropped, so a
   later open never reuses an old answer. */
let prefetched: { at: number; read: Promise<ListResponse> } | null = null;
const PREFETCH_TTL_MS = 30_000;

export function prefetchStartFromSources(): void {
  if (prefetched && Date.now() - prefetched.at < PREFETCH_TTL_MS) return;
  const read = readList("");
  read.catch(() => undefined);
  prefetched = { at: Date.now(), read };
}

function takePrefetched(): Promise<ListResponse> | null {
  const hit = prefetched && Date.now() - prefetched.at < PREFETCH_TTL_MS ? prefetched.read : null;
  prefetched = null;
  return hit;
}

export function useStartFromSources(): StartFromSources {
  const [status, setStatus] = useState<StartFromSources["status"]>("loading");
  const [available, setAvailable] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [campaigns, setCampaigns] = useState<PastCampaignRow[]>([]);
  const [campaignsMore, setCampaignsMore] = useState(false);
  /* The newest request wins, as everywhere a list is searched as you type. */
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (q: string, first: boolean) => {
    const n = ++seq.current;
    try {
      const body = await ((first && !q ? takePrefetched() : null) ?? readList(q));
      if (n !== seq.current) return;
      const list = Array.isArray(body?.templates) ? body.templates : [];
      const past = Array.isArray(body?.campaigns) ? body.campaigns : [];
      setTemplates(list);
      setCampaigns(past);
      setCampaignsMore(Boolean(body?.campaignsMore));
      setCanManage(Boolean(body?.canManage));
      if (first) setAvailable(list.length > 0 || past.length > 0);
      setStatus("ready");
    } catch {
      /* Nothing to start from is the same as a blank form: the row stays
         hidden and the form works exactly as it did without it. */
      if (n === seq.current && first) setStatus("error");
    } finally {
      if (n === seq.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    /* The refs themselves, so the cleanup sees the latest request and the
       latest pending search: on close, both are dropped. */
    const requests = seq;
    const pending = timer;
    void load("", true);
    return () => {
      requests.current++;
      if (pending.current) clearTimeout(pending.current);
    };
  }, [load]);

  const search = useCallback(
    (q: string) => {
      setQuery(q);
      setSearching(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void load(q.trim(), false), SEARCH_DELAY_MS);
    },
    [load],
  );

  const rename = useCallback(async (id: string, name: string) => {
    try {
      const res = await fetch(`/api/campaign-templates/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return { ok: false as const, error: body?.error ?? "Could not rename that template." };
      setTemplates((rows) => rows.map((t) => (t.id === id ? { ...t, name: body?.template?.name ?? name } : t)));
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Could not reach the server." };
    }
  }, []);

  const remove = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/campaign-templates/${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) return { ok: false as const, error: body?.error ?? "Could not delete that template." };
      setTemplates((rows) => rows.filter((t) => t.id !== id));
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Could not reach the server." };
    }
  }, []);

  return { status, available, canManage, query, searching, templates, campaigns, campaignsMore, search, rename, remove };
}

/** One starting point's setup, for the form to pre-fill from. */
export async function fetchSetupSource(
  kind: SourceKind,
  id: string,
): Promise<{ ok: true; source: SetupSourceResponse } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/campaign-templates/source?kind=${kind}&id=${encodeURIComponent(id)}`);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.setup) return { ok: false, error: body?.error ?? "Could not read that setup." };
    return { ok: true, source: body as SetupSourceResponse };
  } catch {
    return { ok: false, error: "Could not reach the server." };
  }
}
