import { useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import {
  useMarkAllReadMutation,
  useNotificationsQuery,
  useUnreadCountQuery,
} from "@/api/endpoints/notifications";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: countData } = useUnreadCountQuery(undefined, { pollingInterval: 30_000 });
  const { data: listData } = useNotificationsQuery({ page: 1 }, { skip: !open });
  const [markAllRead] = useMarkAllReadMutation();
  const unread = countData?.unread ?? 0;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded p-1.5 text-text-muted hover:bg-ink-700 hover:text-text"
        aria-label={unread > 0 ? `${unread} okunmamış bildirim` : "Bildirimler"}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="mono absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-status-high px-1 text-[10px] font-semibold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-1 w-80 rounded-md border border-ink-600 bg-ink-800 shadow-xl">
            <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
              <span className="text-[12px] font-medium uppercase tracking-wide text-text-muted">
                Bildirimler
              </span>
              {unread > 0 && (
                <Button variant="ghost" size="sm" onClick={() => void markAllRead()}>
                  <CheckCheck size={13} /> Tümünü okundu say
                </Button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {!listData || listData.items.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12.5px] text-text-muted">
                  Bildirim yok. Düşük stok uyarıları burada görünür.
                </p>
              ) : (
                listData.items.map((n) => (
                  <div
                    key={n.id}
                    className="border-b border-ink-600/60 px-3 py-2.5 last:border-0"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[13px] font-medium">
                        {!n.read && (
                          <span className="mr-1.5 inline-block size-1.5 rounded-full bg-status-high align-middle" />
                        )}
                        {n.title}
                      </span>
                      <span className="mono shrink-0 text-[10.5px] text-text-faint">
                        {formatDate(n.created_at)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-text-muted">{n.message}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
