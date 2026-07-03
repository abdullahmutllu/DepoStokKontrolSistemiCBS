import { baseApi } from "@/api/baseApi";
import type { AppNotification, Page } from "@/types";

export const notificationsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    notifications: build.query<Page<AppNotification>, { unread_only?: boolean; page?: number }>({
      query: (params) => ({ url: "/notifications", params }),
      providesTags: ["Notification"],
    }),
    unreadCount: build.query<{ unread: number }, void>({
      query: () => "/notifications/unread-count",
      providesTags: ["Notification"],
    }),
    markAllRead: build.mutation<void, void>({
      query: () => ({ url: "/notifications/mark-all-read", method: "POST" }),
      invalidatesTags: ["Notification"],
    }),
    runLowStockCheck: build.mutation<{ created: number }, void>({
      query: () => ({ url: "/notifications/run-low-stock-check", method: "POST" }),
      invalidatesTags: ["Notification", "Report"],
    }),
  }),
});

export const {
  useNotificationsQuery,
  useUnreadCountQuery,
  useMarkAllReadMutation,
  useRunLowStockCheckMutation,
} = notificationsApi;
