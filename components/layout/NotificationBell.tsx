"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { MenuButton, type MenuButtonItem } from "@/components/ds/MenuButton";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { timeAgo } from "@/lib/format";
import {
  collapseNotifications,
  describeNotification,
  formatUnreadBadge,
  isUnread,
  type NotificationItem,
} from "@/lib/notificationFeed";

/**
 * The bell used to render a hardcoded `[{ label: "No new notifications" }]` —
 * a control that could never say anything else. It now reads /api/notifications,
 * which is the org's own AuditLog narrowed to the notification catalog.
 *
 * Read state is per-device: there is no table to put it in, so the last time
 * this browser marked everything read lives in localStorage and the count is
 * whatever is newer than it. localStorage throws outright in some privacy modes,
 * so every access is guarded and the feed degrades to "everything is unread".
 *
 * Opening the bell no longer marks anything read. It used to, on open, so a
 * badge reading 808 vanished after one glance at eight lines -- 800 of them
 * never seen and no longer findable as new. Reading is now an explicit "Mark
 * all as read", every unread line is bold with a dot, runs of the same event
 * are folded into one line ("×5"), and "Show more" pages back through the
 * rest of the 30-day window.
 */
const LAST_SEEN_KEY = "cc:notifications:lastSeen";

/** Rows asked for per request; a page folds into fewer lines once collapsed. */
const PAGE_ROWS = 20;
/** Lines shown at first, and added by each "Show more". */
const STEP = 8;

function readLastSeen(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

type FeedResponse = { items: NotificationItem[]; unreadCount?: number; hasMore?: boolean };

export function NotificationBell() {
  const router = useRouter();
  /* localStorage cannot be read while rendering on the server, so the first
     client paint has to match it: no marker, and the query held back until the
     effect below has looked. */
  const [hydrated, setHydrated] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  /* Older pages fetched by "Show more", and how many lines are on screen. */
  const [older, setOlder] = useState<NotificationItem[]>([]);
  const [olderHasMore, setOlderHasMore] = useState<boolean | null>(null);
  const [visible, setVisible] = useState(STEP);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setLastSeen(readLastSeen());
    setHydrated(true);
  }, []);

  const { data, isError } = useQuery<FeedResponse>({
    queryKey: ["notifications", lastSeen],
    queryFn: () =>
      apiFetch<FeedResponse>(
        `/api/notifications?limit=${PAGE_ROWS}${lastSeen ? `&since=${encodeURIComponent(lastSeen)}` : ""}`
      ),
    enabled: hydrated,
    /* Marking the bell read changes the key. Without this the open dropdown
       would empty itself for the length of the refetch. */
    placeholderData: (prev) => prev,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  const markAllRead = useCallback(() => {
    const now = new Date().toISOString();
    try {
      window.localStorage.setItem(LAST_SEEN_KEY, now);
    } catch {
      /* Nothing to fall back to — the badge just keeps counting. */
    }
    setLastSeen(now);
  }, []);

  /* The first page is refetched on focus and every minute, so a row can arrive
     in both it and an older page; each row is kept once, newest first. */
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return [...(data?.items ?? []), ...older].filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
  }, [data?.items, older]);
  const groups = useMemo(() => collapseNotifications(rows), [rows]);
  const hasMore = older.length > 0 ? olderHasMore === true : data?.hasMore === true;
  const unreadCount = data?.unreadCount ?? 0;
  const badge = formatUnreadBadge(unreadCount);

  const showMore = useCallback(async () => {
    const next = visible + STEP;
    setVisible(next);
    /* Fetch another page only when the lines already loaded will not fill the
       next screenful. `before`/`beforeId` name the oldest row held; the API
       answers the rows strictly after it in the feed's order. */
    if (groups.length > next || !hasMore || loadingMore) return;
    const oldest = rows[rows.length - 1];
    if (!oldest?.createdAt) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<FeedResponse>(
        `/api/notifications?limit=${PAGE_ROWS}&before=${encodeURIComponent(oldest.createdAt)}&beforeId=${encodeURIComponent(oldest.id)}`
      );
      setOlder((prev) => [...prev, ...page.items]);
      setOlderHasMore(page.hasMore === true);
    } catch {
      setOlderHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [visible, groups.length, hasMore, loadingMore, rows]);

  let menu: MenuButtonItem[];
  if (isError) {
    menu = [{ label: "Could not load notifications" }];
  } else if (groups.length === 0) {
    menu = [{ label: "No new notifications" }];
  } else {
    menu = [];
    if (unreadCount > 0) {
      menu.push({
        label: "Mark all as read",
        icon: <CheckCheck size={14} />,
        keepOpen: true,
        onClick: markAllRead,
      });
    }
    for (const group of groups.slice(0, visible)) {
      const { glyph, title, href } = describeNotification(group.item);
      const unread = group.items.some((row) => isUnread(row, lastSeen));
      const times = group.items.length > 1 ? ` ×${group.items.length}` : "";
      menu.push({
        label: `${title}${times} · ${timeAgo(group.item.createdAt)}`,
        icon: <span aria-hidden="true">{glyph}</span>,
        strong: unread,
        trailing: unread ? (
          <>
            <span
              aria-hidden="true"
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--cc-primary)",
                flex: "none",
                marginLeft: "auto",
              }}
            />
            <span className="sr-only">, unread</span>
          </>
        ) : undefined,
        ...(href ? { onClick: () => router.push(href) } : {}),
      });
    }
    if (groups.length > visible || hasMore) {
      menu.push({
        label: loadingMore ? "Loading…" : "Show more",
        keepOpen: true,
        onClick: () => void showMore(),
      });
    }
  }

  return (
    <MenuButton
      align="right"
      label={badge ? `Notifications, ${unreadCount} unread` : "Notifications"}
      trigger={
        <span className="cc-icon-btn" data-action="notifications">
          <Bell size={17} aria-hidden="true" />
          {badge && (
            <span aria-hidden="true" className="cc-icon-btn-badge">
              {badge}
            </span>
          )}
        </span>
      }
      items={menu}
      /* A long list scrolls inside the menu rather than running off the page. */
      menuStyle={{ maxHeight: "min(70vh, 560px)", overflowY: "auto", overflowX: "hidden" }}
    />
  );
}
