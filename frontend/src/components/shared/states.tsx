import type { ReactNode } from "react";
import { AlertTriangle, PackageOpen, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Empty states direct the user to the next action — never just a mood. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-ink-600 px-6 py-10 text-center">
      <PackageOpen className="text-text-faint" size={28} strokeWidth={1.5} />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-[13px] text-text-muted">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-status-high/30 bg-status-high/5 px-6 py-8 text-center">
      <AlertTriangle className="text-status-high" size={24} strokeWidth={1.5} />
      <p className="text-sm text-text">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RotateCw size={13} /> Yeniden dene
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 py-2" aria-busy="true" aria-label="Yükleniyor">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 animate-pulse rounded bg-ink-700/60" />
      ))}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-0.5 text-[13px] text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
