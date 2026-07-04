"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Avatar, Badge, Tag, EmptyState, Skeleton } from "@pratham7711/ui";
import { Send } from "lucide-react";

type SenderType = "ORG" | "CREATOR" | "AI_AGENT";

type ConversationSummary = {
  id: string;
  creatorUser: { id: string; name: string; handle: string; avatarUrl: string | null };
  campaign: { id: string; title: string } | null;
  lastMessageAt: string | null;
  lastMessage: { body: string; senderType: SenderType; createdAt: string } | null;
  unreadCount: number;
};

type ThreadMessage = {
  id: string;
  senderType: SenderType;
  senderUserId: string | null;
  body: string;
  negotiationOfferId: string | null;
  readAt: string | null;
  createdAt: string;
};

type ThreadData = {
  conversation: {
    id: string;
    creatorUser: { id: string; name: string; handle: string; avatarUrl: string | null };
    campaign: { id: string; title: string } | null;
  };
  messages: ThreadMessage[];
};

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function withAt(handle: string): string {
  return handle.startsWith("@") ? handle : `@${handle}`;
}

export default function InboxClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialC = searchParams.get("c");

  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [listError, setListError] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(initialC);
  const [thread, setThread] = useState<ThreadData | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/messages");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setConversations(data.conversations ?? []);
      setListError(false);
    } catch {
      setListError(true);
      setConversations((prev) => prev ?? []);
    }
  }, []);

  const loadThread = useCallback(async (id: string, silent = false) => {
    if (!silent) {
      setThreadLoading(true);
      setThreadError(false);
    }
    try {
      const res = await fetch(`/api/messages/${id}`);
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setThread(data);
      setThreadError(false);
    } catch {
      if (!silent) setThreadError(true);
    } finally {
      if (!silent) setThreadLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!activeId) {
      setThread(null);
      return;
    }
    loadThread(activeId);
  }, [activeId, loadThread]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadConversations();
      if (activeId) loadThread(activeId, true);
    }, 5000);
    return () => clearInterval(interval);
  }, [activeId, loadConversations, loadThread]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread?.messages.length, activeId]);

  const selectConversation = (id: string) => {
    setActiveId(id);
    router.replace(`/inbox?c=${id}`);
  };

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !activeId || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/messages/${activeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setDraft("");
        await loadThread(activeId, true);
        await loadConversations();
      }
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="cc-page-content" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Inbox</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Direct messages with your creators</p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 0,
          flex: 1,
          minHeight: 0,
          background: "var(--cc-card)",
          border: "1px solid var(--cc-border)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <div style={{ borderRight: "1px solid var(--cc-border)", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {conversations === null ? (
              <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} height="56px" borderRadius="10px" />
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div style={{ padding: 24 }}>
                <EmptyState
                  icon="💬"
                  title="No conversations yet"
                  description="Message a creator from their profile"
                />
              </div>
            ) : (
              conversations.map((c) => {
                const active = c.id === activeId;
                return (
                  <button
                    key={c.id}
                    onClick={() => selectConversation(c.id)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      border: "none",
                      borderBottom: "1px solid var(--cc-border)",
                      background: active ? "var(--cc-primary-light)" : "transparent",
                      cursor: "pointer",
                    }}
                  >
                    <Avatar name={c.creatorUser.name} src={c.creatorUser.avatarUrl ?? undefined} size="sm" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: "var(--cc-text)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.creatorUser.name}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--cc-text-muted)", flexShrink: 0 }}>
                          {formatTime(c.lastMessageAt)}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <span
                          style={{
                            flex: 1,
                            fontSize: 12,
                            color: "var(--cc-text-muted)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.lastMessage?.body ?? "No messages yet"}
                        </span>
                        {c.unreadCount > 0 && <Badge variant="accent">{c.unreadCount}</Badge>}
                      </div>
                      {c.campaign && (
                        <div style={{ marginTop: 4 }}>
                          <Tag>{c.campaign.title}</Tag>
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          {!activeId ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
              <EmptyState icon="✉️" title="Select a conversation" description="Choose a creator from the list to view messages" />
            </div>
          ) : threadLoading ? (
            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} height="48px" borderRadius="10px" />
              ))}
            </div>
          ) : threadError ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
              <EmptyState icon="⚠️" title="Couldn't load conversation" description="Try selecting it again" />
            </div>
          ) : thread ? (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--cc-border)",
                  flexShrink: 0,
                }}
              >
                <Avatar name={thread.conversation.creatorUser.name} src={thread.conversation.creatorUser.avatarUrl ?? undefined} size="sm" />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>
                    {thread.conversation.creatorUser.name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                    {withAt(thread.conversation.creatorUser.handle)}
                    {thread.conversation.campaign && <> · {thread.conversation.campaign.title}</>}
                  </div>
                </div>
              </div>

              <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                {thread.messages.map((m) => {
                  const isOrg = m.senderType === "ORG";
                  const isAi = m.senderType === "AI_AGENT";
                  return (
                    <div
                      key={m.id}
                      style={{ display: "flex", justifyContent: isOrg ? "flex-end" : "flex-start" }}
                    >
                      <div style={{ maxWidth: "72%" }}>
                        {isAi && (
                          <div style={{ marginBottom: 4 }}>
                            <Tag>AI</Tag>
                          </div>
                        )}
                        <div
                          style={{
                            padding: "9px 14px",
                            borderRadius: 14,
                            fontSize: 14,
                            lineHeight: 1.5,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            background: isOrg ? "var(--cc-primary)" : "var(--cc-bg)",
                            color: isOrg ? "#fff" : "var(--cc-text)",
                            border: isOrg ? "none" : "1px solid var(--cc-border)",
                          }}
                        >
                          {m.body}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "var(--cc-text-subtle)",
                            marginTop: 3,
                            textAlign: isOrg ? "right" : "left",
                          }}
                        >
                          {formatTime(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ borderTop: "1px solid var(--cc-border)", padding: 12, display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0 }}>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message…"
                  rows={1}
                  style={{
                    flex: 1,
                    resize: "none",
                    border: "1px solid var(--cc-border)",
                    borderRadius: 10,
                    padding: "10px 12px",
                    fontSize: 14,
                    color: "var(--cc-text)",
                    background: "var(--cc-card)",
                    fontFamily: "inherit",
                    maxHeight: 120,
                  }}
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !draft.trim()}
                  aria-label="Send message"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    border: "none",
                    background: "var(--cc-primary)",
                    color: "#fff",
                    cursor: sending || !draft.trim() ? "not-allowed" : "pointer",
                    opacity: sending || !draft.trim() ? 0.5 : 1,
                    flexShrink: 0,
                  }}
                >
                  <Send size={16} />
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
