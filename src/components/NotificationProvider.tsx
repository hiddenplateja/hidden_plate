// src/components/NotificationProvider.tsx
// Context provider for the notification system.
//
// Responsibilities:
//   1. On user login → register the device for push notifications
//      (saves the Expo push token to Appwrite so the send-notification
//      Function can target this device).
//   2. On user logout → clear push tokens for that user from Appwrite.
//   3. Loads & maintains the notification list + unread count.
//   4. Listens for incoming push events (foreground + tap) and routes
//      them appropriately.
//
// Must be mounted INSIDE <AuthProvider> so it can read `useAuth()`.

import * as Notifications from "expo-notifications";
import { useRouter, type Href } from "expo-router";
import {
    createContext,
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";

import { useAuth } from "@/hooks/useAuth";
import {
    deleteNotification as deleteNotificationDoc,
    getUnreadCount,
    listMyNotifications,
    markAllRead as markAllReadSvc,
    markRead as markReadSvc,
} from "@/services/notifications";
import { registerForPushNotifications } from "@/services/pushTokens";
import type {
    AppNotification,
    NotificationData,
    NotificationType,
} from "@/types/notification";

// ─── How pushes appear when the app is in the foreground ─────────────────────
// Without this, an incoming push only buzzes when the app is backgrounded.
// We want the banner + sound + badge in-foreground too so the user knows.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// ─── Context shape ───────────────────────────────────────────────────────────

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  hasMore: boolean;
  pushToken: string | null;

  refresh: () => Promise<void>;
  fetchMore: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  removeNotification: (id: string) => Promise<void>;
}

export const NotificationContext = createContext<
  NotificationContextValue | undefined
>(undefined);

// ─── Provider ────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

interface NotificationProviderProps {
  children: ReactNode;
}

export function NotificationProvider({ children }: NotificationProviderProps) {
  const { user } = useAuth();
  const router = useRouter();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);

  // Track which user we last registered for, so login/logout transitions
  // correctly clear push tokens for the previous account.
  const lastRegisteredUserId = useRef<string | null>(null);

  // ─── Loaders ──────────────────────────────────────────────────────────────

  const loadInitial = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      const [page, count] = await Promise.all([
        listMyNotifications({ pageSize: PAGE_SIZE }),
        getUnreadCount(),
      ]);
      setNotifications(page.items);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
      setUnreadCount(count);
    } catch (err) {
      console.warn("[notifications] initial load failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  const fetchMore = useCallback(async () => {
    if (!user || !hasMore || isLoading) return;
    setIsLoading(true);
    try {
      const page = await listMyNotifications({
        pageSize: PAGE_SIZE,
        cursor: nextCursor,
      });
      setNotifications((prev) => [...prev, ...page.items]);
      setHasMore(page.hasMore);
      setNextCursor(page.nextCursor);
    } catch (err) {
      console.warn("[notifications] fetchMore failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, [user, hasMore, isLoading, nextCursor]);

  const refresh = useCallback(async () => {
    await loadInitial();
  }, [loadInitial]);

  // ─── Mutations ────────────────────────────────────────────────────────────

  const markAsRead = useCallback(async (id: string) => {
    // Optimistic update first
    setNotifications((prev) =>
      prev.map((n) => (n.id === id && !n.isRead ? { ...n, isRead: true } : n)),
    );
    setUnreadCount((prev) => {
      // Only decrement if the notification was previously unread
      return Math.max(0, prev - 1);
    });

    try {
      await markReadSvc(id);
    } catch (err) {
      console.warn("[notifications] markAsRead failed:", err);
      // We don't revert the optimistic update — a failed write here is
      // not user-visible and will resolve on next refresh.
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    // Optimistic
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);

    try {
      await markAllReadSvc();
    } catch (err) {
      console.warn("[notifications] markAllAsRead failed:", err);
    }
  }, []);

  const removeNotification = useCallback(
    async (id: string) => {
      const target = notifications.find((n) => n.id === id);

      // Optimistic
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (target && !target.isRead) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }

      try {
        await deleteNotificationDoc(id);
      } catch (err) {
        console.warn("[notifications] remove failed:", err);
        // Re-add on failure? Generally no — the user explicitly swiped it
        // away and re-appearing rows are jarring. They can pull-to-refresh
        // if something went wrong.
      }
    },
    [notifications],
  );

  // ─── Push registration tied to auth state ─────────────────────────────────

  useEffect(() => {
    if (!user) {
      // Logout — token cleanup happens in auth.logout() while the session is
      // still alive (the Function that owns pushTokens needs the caller's auth
      // header). Here we just reset local state.
      if (lastRegisteredUserId.current) {
        lastRegisteredUserId.current = null;
        setPushToken(null);
      }
      // Also clear the in-memory notification list
      setNotifications([]);
      setUnreadCount(0);
      setHasMore(false);
      setNextCursor(null);
      return;
    }

    // Login — register for push + load notifications
    if (lastRegisteredUserId.current !== user.id) {
      lastRegisteredUserId.current = user.id;
      registerForPushNotifications(user.id)
        .then((token) => {
          if (token) setPushToken(token);
        })
        .catch((err) => {
          console.warn("[notifications] push registration failed:", err);
        });
    }

    loadInitial();
  }, [user, loadInitial]);

  // ─── Foreground push listeners ────────────────────────────────────────────

  useEffect(() => {
    if (!user) return;

    // Fires when a push arrives while the app is in the foreground.
    // We don't dedupe against the existing list — the user might already
    // have the notification from the initial load. Instead we just bump
    // the unread count and refresh on next view.
    const receivedSub = Notifications.addNotificationReceivedListener(() => {
      setUnreadCount((c) => c + 1);
      // Soft refresh — fetch fresh list in the background so the new
      // notification appears next time the screen opens.
      loadInitial();
    });

    // Fires when the user TAPS a notification (foreground or background).
    // We route them to the right screen based on the data payload.
    const responseSub = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const raw = response.notification.request.content.data as
          | ({ type?: NotificationType } & NotificationData)
          | undefined;
        if (!raw || !raw.type) return;

        switch (raw.type) {
          case "follow":
            if (raw.actorName) {
              // follow notifications carry the actor ID via the AppNotification doc,
              // but the push payload doesn't include actorId by default. Route to
              // the generic notifications screen and let the user tap from there.
              router.push("/notifications");
            }
            break;
          case "like":
          case "comment":
            if (raw.postId) {
              router.push(`/post/${raw.postId}` as unknown as Href);
            } else if (raw.reviewId) {
              router.push(`/review/${raw.reviewId}`);
            } else {
              router.push("/notifications");
            }
            break;
          case "new_restaurant":
            if (raw.restaurantId) {
              router.push(`/restaurant/${raw.restaurantId}`);
            } else {
              router.push("/notifications");
            }
            break;
          default:
            router.push("/notifications");
        }
      },
    );

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [user, router, loadInitial]);

  const value: NotificationContextValue = {
    notifications,
    unreadCount,
    isLoading,
    hasMore,
    pushToken,
    refresh,
    fetchMore,
    markAsRead,
    markAllAsRead,
    removeNotification,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
