"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { Dropdown } from "@pratham7711/ui";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { timeAgo } from "@/lib/format";
import {
  describeNotification,
  formatUnreadBadge,
  type NotificationItem,
} from "@/lib/notificationFeed";

/**
 * The bell used to render a hardcoded `[{ label: "No new notifications" }]` —
 * a control that could never say anything else. It now reads /api/notifications,
 * which is the org's own AuditLog narrowed to the notification catalog.
 *
 * Read state is per-device: there is no table to put it in, so the last time
 * this browser opened the bell lives in localStorage and the count is whatever
 * is newer than it. localStorage throws outright in some privacy modes, so
 * every access is guarded and the feed degrades to "everything is unread".
 */
const LAST_SEEN_KEY = "cc:notifications:lastSeen";

function readLastSeen(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

type FeedResponse = { items: NotificationItem[]; unreadCount: number };

export function NotificationBell() {
  const router = useRouter();
  /* localStorage cannot be read while rendering on the server, so the first
     client paint has to match it: no marker, and the query held back until the
     effect below has looked. */
  const [hydrated, setHydrated] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(null);

  useEffect(() => {
    setLastSeen(readLastSeen());
    setHydrated(true);
  }, []);

  const { data, isError } = useQuery<FeedResponse>({
    queryKey: ["notifications", lastSeen],
    queryFn: () =>
      apiFetch<FeedResponse>(
        `/api/notifications${lastSeen ? `?since=${encodeURIComponent(lastSeen)}` : ""}`
      ),
    enabled: hydrated,
    /* Marking the bell seen changes the key. Without this the open dropdown
       would empty itself for the length of the refetch. */
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    try {
      window.localStorage.setItem(LAST_SEEN_KEY, now);
    } catch {
      /* Nothing to fall back to — the badge just keeps counting. */
    }
    setLastSeen(now);
  }, []);

  const items = data?.items ?? [];
  const badge = formatUnreadBadge(data?.unreadCount ?? 0);

  const menu = isError
    ? [{ label: "Could not load notifications" }]
    : items.length === 0
      ? [{ label: "No new notifications" }]
      : items.map((item) => {
          const { glyph, title, href } = describeNotification(item);
          return {
            label: `${title} · ${timeAgo(item.createdAt)}`,
            icon: <span aria-hidden="true">{glyph}</span>,
            ...(href ? { onClick: () => router.push(href) } : {}),
          };
        });

  return (
    <Dropdown
      align="right"
      tabIndex={0}
      role="button"
      aria-haspopup="menu"
      aria-label={badge ? `Notifications, ${data?.unreadCount} unread` : "Notifications"}
      onClick={markSeen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") markSeen();
      }}
      trigger={
        <span
          className="cc-btn-ghost"
          style={{
            position: "relative",
            width: 34,
            height: 34,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            color: "var(--cc-text-muted)",
          }}
        >
          <Bell size={17} aria-hidden="true" />
          {badge && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 1,
                right: 1,
                minWidth: 15,
                height: 15,
                padding: "0 3px",
                borderRadius: 8,
                background: "var(--cc-danger)",
                color: "#FFFFFF",
                fontSize: 9,
                fontWeight: 700,
                lineHeight: "15px",
                textAlign: "center",
              }}
            >
              {badge}
            </span>
          )}
        </span>
      }
      items={menu}
    />
  );
}
