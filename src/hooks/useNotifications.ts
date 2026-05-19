// src/hooks/useNotifications.ts
// Hook for accessing the notification context.
//
// Components anywhere inside <NotificationProvider> can call this to read
// the current notification list, unread count, and trigger reads/deletes.

import { useContext } from "react";

import { NotificationContext } from "@/components/NotificationProvider";

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error(
      "useNotifications must be used inside <NotificationProvider>. " +
        "Wrap your app tree in app/_layout.tsx.",
    );
  }
  return ctx;
}
