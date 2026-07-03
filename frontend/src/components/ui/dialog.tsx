import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  title,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink-950/80" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-md border border-ink-600 bg-ink-800 shadow-xl focus:outline-none",
          className,
        )}
        {...props}
      >
        <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3">
          <DialogPrimitive.Title className="font-display text-sm font-semibold">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close
            className="rounded p-1 text-text-muted hover:bg-ink-700 hover:text-text"
            aria-label="Kapat"
          >
            <X size={15} />
          </DialogPrimitive.Close>
        </div>
        <div className="p-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
