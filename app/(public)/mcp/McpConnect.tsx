"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Copy, Plug, Sparkles, Terminal, Unplug } from "lucide-react";

type Tool = { name: string; label: string };
type Connection = { clientId: string; name: string; connectedAt: string; lastUsedAt: string | null };
type ClientTab = "claude" | "claude-code" | "other";

const PROMPTS = [
  "Which of my campaigns got the most views in the last 7 days?",
  "How is my newest campaign doing? Show its top 5 posts.",
  "Which creators have the best engagement rate across my campaigns?",
  "List posts on my active campaigns that haven't been measured yet.",
];

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1800);
    } catch {
      setCopied(null);
    }
  }, []);
  return { copied, copy };
}

function CopyIcon({ done }: { done: boolean }) {
  return done ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />;
}

function CodeLine({ id, text, copied, onCopy, label }: { id: string; text: string; copied: boolean; onCopy: () => void; label: string }) {
  return (
    <div className="mcp-code" data-testid={id}>
      <code>{text}</code>
      <button type="button" className="mcp-code-copy" onClick={onCopy} aria-label={label}>
        <CopyIcon done={copied} />
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

function when(iso: string | null): string {
  if (!iso) return "not used yet";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function McpConnect({
  brandName,
  mcpUrl,
  signedIn,
  apiAccess,
  tools,
}: {
  brandName: string;
  mcpUrl: string;
  signedIn: boolean;
  apiAccess: boolean | null;
  tools: Tool[];
}) {
  const { copied, copy } = useCopy();
  const [tab, setTab] = useState<ClientTab>("claude");
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const claudeLink =
    "https://claude.ai/customize/connectors?modal=add-custom-connector" +
    `&connectorName=${encodeURIComponent(brandName)}&connectorUrl=${encodeURIComponent(mcpUrl)}`;
  const serverName = brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const claudeCodeCommand = `claude mcp add --transport http ${serverName} ${mcpUrl}`;

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetch("/api/oauth/connections")
      .then((r) => (r.ok ? r.json() : { connections: [] }))
      .then((j) => live && setConnections(j.connections ?? []))
      .catch(() => live && setConnections([]));
    return () => {
      live = false;
    };
  }, [signedIn]);

  const disconnect = async (clientId: string) => {
    setBusy(clientId);
    try {
      const res = await fetch(`/api/oauth/connections?clientId=${encodeURIComponent(clientId)}`, { method: "DELETE" });
      if (res.ok) setConnections((list) => (list ?? []).filter((c) => c.clientId !== clientId));
    } finally {
      setBusy(null);
    }
  };

  const tabs: { key: ClientTab; label: string; tone: string }[] = [
    { key: "claude", label: "Claude", tone: "lp-tone-orange" },
    { key: "claude-code", label: "Claude Code", tone: "lp-tone-violet" },
    { key: "other", label: "Other apps", tone: "lp-tone-blue" },
  ];

  return (
    <>
      <section className="lp-hero-wrap mcp-hero" aria-labelledby="mcp-title">
        <div className="lp-shell lp-hero mcp-hero-inner">
          <p className="lp-eyebrow lp-rise">
            <span className="lp-eyebrow-dot" aria-hidden />
            {brandName} MCP
          </p>
          <h1 id="mcp-title" className="lp-h1 lp-rise lp-rise-2">
            Your campaigns, <span className="lp-grad-text">inside Claude.</span>
          </h1>
          <p className="lp-lead lp-rise lp-rise-2">
            Ask about campaigns, posts and creators in plain words. Claude reads your workspace live, as you.
          </p>
          <div className="lp-cta-row lp-rise lp-rise-3">
            <a href={claudeLink} target="_blank" rel="noopener noreferrer" className="lp-btn lp-btn-primary" data-testid="mcp-add-to-claude">
              Add to Claude
              <ArrowUpRight size={18} aria-hidden />
            </a>
            <button type="button" className="lp-btn lp-btn-ghost" onClick={() => copy("hero-url", mcpUrl)} data-testid="mcp-copy-url">
              <CopyIcon done={copied === "hero-url"} />
              {copied === "hero-url" ? "Copied" : "Copy server URL"}
            </button>
          </div>
          <div className="mcp-url lp-rise lp-rise-4">
            <span className="mcp-url-label">Server URL</span>
            <code data-testid="mcp-url">{mcpUrl}</code>
          </div>
        </div>
      </section>

      <section id="connect" className="lp-section lp-section-tight" aria-labelledby="mcp-connect-title">
        <div className="lp-shell">
          <p className="lp-kicker lp-tone-violet">Connect</p>
          <h2 id="mcp-connect-title" className="lp-h2">
            Three steps. No keys to copy.
          </h2>
          <div className="lp-seg mcp-tabs" role="group" aria-label="Choose your app">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                aria-pressed={tab === t.key}
                className={`lp-seg-btn ${t.tone}`}
                onClick={() => setTab(t.key)}
                data-testid={`mcp-tab-${t.key}`}
              >
                {t.key === "claude-code" ? <Terminal size={16} aria-hidden /> : t.key === "claude" ? <Sparkles size={16} aria-hidden /> : <Plug size={16} aria-hidden />}
                {t.label}
              </button>
            ))}
          </div>

          <ol className="mcp-steps" aria-live="polite" data-testid={`mcp-steps-${tab}`}>
            {tab === "claude" && (
              <>
                <li>
                  <strong>Add it</strong>
                  <span>
                    Press <a href={claudeLink} target="_blank" rel="noopener noreferrer">Add to Claude</a>, or in Claude open
                    Customize → Connectors → Add custom connector and paste the server URL.
                  </span>
                </li>
                <li>
                  <strong>Sign in</strong>
                  <span>Press Connect, sign in to {brandName} and press Allow.</span>
                </li>
                <li>
                  <strong>Ask</strong>
                  <span>Turn the connector on in a chat and ask about your campaigns.</span>
                </li>
              </>
            )}
            {tab === "claude-code" && (
              <>
                <li>
                  <strong>Add it</strong>
                  <CodeLine
                    id="mcp-claude-code-command"
                    text={claudeCodeCommand}
                    copied={copied === "cc"}
                    onCopy={() => copy("cc", claudeCodeCommand)}
                    label="Copy the Claude Code command"
                  />
                </li>
                <li>
                  <strong>Sign in</strong>
                  <span>
                    Type <code>/mcp</code> in Claude Code, pick <code>{serverName}</code>, choose Authenticate, then press Allow.
                  </span>
                </li>
                <li>
                  <strong>Ask</strong>
                  <span>Ask about your campaigns in any session.</span>
                </li>
              </>
            )}
            {tab === "other" && (
              <>
                <li>
                  <strong>Add it</strong>
                  <span>Add a remote MCP server (Streamable HTTP) with the server URL.</span>
                </li>
                <li>
                  <strong>Sign in</strong>
                  <span>When the app asks, sign in to {brandName} and press Allow.</span>
                </li>
                <li>
                  <strong>Ask</strong>
                  <span>Its tools appear in the app.</span>
                </li>
              </>
            )}
          </ol>
        </div>
      </section>

      <section id="ask" className="lp-section lp-section-tight" aria-labelledby="mcp-ask-title">
        <div className="lp-shell">
          <p className="lp-kicker lp-tone-green">Try asking</p>
          <h2 id="mcp-ask-title" className="lp-h2">
            Questions it answers from live data.
          </h2>
          <ul className="mcp-prompts">
            {PROMPTS.map((p, i) => (
              <li key={p} className="lp-card mcp-prompt">
                <p>{p}</p>
                <button type="button" className="mcp-code-copy" onClick={() => copy(`p${i}`, p)} aria-label={`Copy: ${p}`}>
                  <CopyIcon done={copied === `p${i}`} />
                  <span>{copied === `p${i}` ? "Copied" : "Copy"}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="tools" className="lp-section lp-section-tight" aria-labelledby="mcp-tools-title">
        <div className="lp-shell">
          <p className="lp-kicker lp-tone-blue">What it can do</p>
          <h2 id="mcp-tools-title" className="lp-h2">
            {tools.length} tools, all read-only but one.
          </h2>
          <ul className="mcp-tools" data-testid="mcp-tools">
            {tools.map((t) => (
              <li key={t.name}>
                <span>{t.label}</span>
                <code>{t.name}</code>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="connected" className="lp-section lp-section-tight" aria-labelledby="mcp-connected-title">
        <div className="lp-shell">
          <p className="lp-kicker lp-tone-pink">Your connections</p>
          <h2 id="mcp-connected-title" className="lp-h2">
            Connected apps
          </h2>
          {!signedIn ? (
            <p className="lp-section-lead">
              <Link href="/login?callbackUrl=%2Fmcp%23connected">Sign in</Link> to see and disconnect the apps you have connected.
            </p>
          ) : (
            <div className="mcp-connected" data-testid="mcp-connected">
              {apiAccess === false && (
                <p className="mcp-note" role="status">
                  Your workspace&rsquo;s plan doesn&rsquo;t include API access, so apps can&rsquo;t connect yet.
                </p>
              )}
              {connections === null ? (
                <p className="mcp-muted">Loading…</p>
              ) : connections.length === 0 ? (
                <p className="mcp-muted">No apps connected yet.</p>
              ) : (
                <ul className="mcp-conn-list">
                  {connections.map((c) => (
                    <li key={c.clientId} className="lp-card mcp-conn">
                      <div>
                        <strong>{c.name}</strong>
                        <span className="mcp-muted">
                          Connected {when(c.connectedAt)} · last used {when(c.lastUsedAt)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="lp-btn lp-btn-ghost lp-btn-sm"
                        onClick={() => disconnect(c.clientId)}
                        disabled={busy === c.clientId}
                      >
                        <Unplug size={16} aria-hidden />
                        {busy === c.clientId ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <details className="mcp-details">
            <summary>Use an API key instead</summary>
            <p>
              For scripts and servers: create a key in <Link href="/settings/api-keys">Settings → API keys</Link> and send it
              as <code>Authorization: Bearer &lt;key&gt;</code>. A key reads the whole workspace; signing in reads only what
              you can see.
            </p>
          </details>
        </div>
      </section>
    </>
  );
}
