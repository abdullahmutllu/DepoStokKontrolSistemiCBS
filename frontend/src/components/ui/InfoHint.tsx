import * as Tooltip from "@radix-ui/react-tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/** Küçük bilgi simgesi + üzerine gelince açıklama balonu. Bir bölümün ne işe
 * yaradığını tek cümlede anlatmak için; klavye ve dokunmatikte de açılır. */
export function InfoHint({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip.Provider delayDuration={120}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={text}
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-text-faint transition-colors hover:text-accent focus:outline-none focus-visible:text-accent",
              className,
            )}
          >
            <Info size={13} strokeWidth={2} />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="bottom"
            align="start"
            sideOffset={5}
            collisionPadding={10}
            className="z-50 max-w-64 rounded-md border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-[12px] leading-snug text-text-muted shadow-xl"
          >
            {text}
            <Tooltip.Arrow className="fill-ink-600" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
