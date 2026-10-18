import * as Notifications from "expo-notifications";
import { useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { NotificationContext, type NotificationContextValue } from "@/components/NotificationProvider";
import { useAuth } from "@/hooks/useAuth";
import { useAccountActionScope } from "@/hooks/useAccountActionScope";
import { captureSupabaseActionIdentity } from "@/services/supabaseSessionFence";
import { deleteNotification, getUnreadCount, listMyNotifications, markAllRead, markRead } from "@/services/notifications";
import { registerForPushNotifications } from "@/services/pushTokens";
import { verifiedNotificationDestination, verifySupabasePushEvent } from "@/services/supabasePushEvents";
import type { AppNotification } from "@/types/notification";

/** Same context contract and routing, with no stale-account callbacks/state. */
export function ScopedSupabaseNotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const router = useRouter();
  const begin = useAccountActionScope();
  const revision = captureSupabaseActionIdentity().revision;
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const generation = useRef(0);
  const loadInitial = useCallback(async () => {
    const action = begin(); if (!action.isCurrent()) return;
    const ticket = ++generation.current;
    setLoading(true);
    try {
      const [page, count] = await action.run(() => Promise.all([listMyNotifications({ pageSize: 20 }), getUnreadCount()]));
      if (ticket !== generation.current) return;
      setNotifications(page.items); setUnreadCount(count); setHasMore(page.hasMore); setNextCursor(page.nextCursor);
    } catch { /* Keep already verified data on a transient error. */ }
    finally { if (action.canUpdate() && ticket === generation.current) setLoading(false); }
  }, [begin]);
  const fetchMore = useCallback(async () => {
    const action = begin(); if (!hasMore || isLoading || !action.isCurrent()) return;
    const ticket = ++generation.current;
    setLoading(true);
    try {
      const page = await action.run(() => listMyNotifications({ pageSize: 20, cursor: nextCursor }));
      if (ticket !== generation.current) return;
      setNotifications(previous => [...previous, ...page.items]); setHasMore(page.hasMore); setNextCursor(page.nextCursor);
    } catch { /* No partial/stale append on failure. */ }
    finally { if (action.canUpdate() && ticket === generation.current) setLoading(false); }
  }, [begin, hasMore, isLoading, nextCursor]);
  const markAsRead = useCallback(async (id: string) => {
    const action = begin(); if (!action.isCurrent()) return;
    const target = notifications.find(item => item.id === id);
    setNotifications(previous => previous.map(item => item.id === id ? { ...item, isRead: true } : item));
    if (target && !target.isRead) setUnreadCount(previous => Math.max(0, previous - 1));
    try { await action.run(() => markRead(id)); } catch { /* Pull-to-refresh reconciles optimistic state. */ }
  }, [begin, notifications]);
  const markAllAsRead = useCallback(async () => {
    const action = begin(); if (!action.isCurrent()) return;
    setNotifications(previous => previous.map(item => ({ ...item, isRead: true }))); setUnreadCount(0);
    try { await action.run(markAllRead); } catch { /* Pull-to-refresh reconciles optimistic state. */ }
  }, [begin]);
  const removeNotification = useCallback(async (id: string) => {
    const action = begin(); if (!action.isCurrent()) return;
    const target = notifications.find(item => item.id === id);
    setNotifications(previous => previous.filter(item => item.id !== id));
    if (target && !target.isRead) setUnreadCount(previous => Math.max(0, previous - 1));
    try { await action.run(() => deleteNotification(id)); } catch { /* Pull-to-refresh reconciles optimistic state. */ }
  }, [begin, notifications]);

  useEffect(() => {
    generation.current++;
    setNotifications([]); setUnreadCount(0); setHasMore(false); setNextCursor(null); setPushToken(null); setLoading(false);
  }, [userId]);
  useEffect(() => { void loadInitial(); }, [loadInitial, revision]);
  useEffect(() => {
    const action = begin(); if (!userId || !action.isCurrent()) return;
    let disposed = false;
    void action.run(() => registerForPushNotifications(userId)).then(token => {
      if (!disposed && action.isCurrent()) setPushToken(token);
    }).catch(() => {});
    // Logout cleanup stays in auth while its original credentials are alive.
    return () => { disposed = true; };
  }, [begin, userId, revision]);
  useEffect(() => {
    if (!userId) return;
    let disposed = false;
    const received = Notifications.addNotificationReceivedListener(notification => {
      const action = begin(); if (disposed || !action.isCurrent()) return;
      void action.run(() => verifySupabasePushEvent(notification.request.content.data)).then(row => {
        if (!disposed && action.isCurrent() && row?.userId === userId) void loadInitial();
      }).catch(() => {});
    });
    const pending = new Set<string>(), handled = new Set<string>();
    const handleResponse = (event: Notifications.NotificationResponse) => {
      const action = begin(); if (disposed || !action.isCurrent()) return;
      const key = event.notification.request.identifier;
      if (pending.has(key) || handled.has(key)) return;
      pending.add(key);
      void action.run(() => verifySupabasePushEvent(event.notification.request.content.data)).then(row => {
        if (!disposed && action.isCurrent() && row?.userId === userId) {
          handled.add(key);
          router.push(verifiedNotificationDestination(row) as Href);
          void action.run(Notifications.clearLastNotificationResponseAsync).catch(() => {});
        }
      }).catch(() => {}).finally(() => pending.delete(key));
    };
    const response = Notifications.addNotificationResponseReceivedListener(handleResponse);
    const startup = begin();
    if (startup.isCurrent()) void startup.run(Notifications.getLastNotificationResponseAsync).then(event => {
      if (!disposed && startup.isCurrent() && event) handleResponse(event);
    }).catch(() => {});
    return () => { disposed = true; received.remove(); response.remove(); };
  }, [begin, userId, router, loadInitial]);
  const value: NotificationContextValue = { notifications, unreadCount, isLoading, hasMore, pushToken,
    refresh: loadInitial, fetchMore, markAsRead, markAllAsRead, removeNotification };
  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
