import type { ReactNode } from "react";
import { Boxes } from "lucide-react";

/** Auth screens: quiet ink field, the console introduces itself with its job. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded bg-accent/15 text-accent">
            <Boxes size={20} strokeWidth={1.75} />
          </span>
          <div>
            <div className="font-display text-base font-semibold leading-tight">Depo Konsolu</div>
            <div className="mono text-[11px] uppercase tracking-widest text-text-faint">
              stok · mekân · kontrol
            </div>
          </div>
        </div>
        <div className="rounded-md border border-ink-600 bg-ink-800 p-5">{children}</div>
      </div>
    </div>
  );
}
