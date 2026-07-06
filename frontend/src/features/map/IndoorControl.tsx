import { Layers, LogOut } from "lucide-react";
import type { Level } from "@/types";

/** İç mekân kat seçici + çıkış — haritada bir depoya girildiğinde görünür.
 * Kat düğmeleri en üst kat en yukarıda olacak şekilde dikey sıralanır. */
export function IndoorControl({
  warehouseName,
  levels,
  activeLevel,
  onLevel,
  onExit,
}: {
  warehouseName: string;
  levels: Level[];
  activeLevel: number;
  onLevel: (ordinal: number) => void;
  onExit: () => void;
}) {
  const sorted = [...levels].sort((a, b) => b.ordinal - a.ordinal);
  return (
    <div className="absolute right-3 top-3 z-20 w-44 rounded-md border border-ink-600 bg-ink-900/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between gap-2 border-b border-ink-600 px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-text">
          <Layers size={13} className="shrink-0 text-accent" />
          <span className="truncate" title={warehouseName}>
            {warehouseName}
          </span>
        </span>
        <button
          onClick={onExit}
          aria-label="İç mekândan çık"
          title="Dış haritaya dön"
          className="rounded p-0.5 text-text-muted hover:bg-ink-700 hover:text-text"
        >
          <LogOut size={13} />
        </button>
      </div>
      <div className="flex flex-col gap-0.5 p-1.5" role="radiogroup" aria-label="Kat seçici">
        {sorted.length === 0 && (
          <span className="px-1.5 py-1 text-[11px] text-text-faint">Kat bilgisi yok</span>
        )}
        {sorted.map((lv) => {
          const active = lv.ordinal === activeLevel;
          return (
            <button
              key={lv.id}
              role="radio"
              aria-checked={active}
              onClick={() => onLevel(lv.ordinal)}
              className={`flex items-center justify-between rounded px-2 py-1 text-[12px] transition-colors ${
                active
                  ? "bg-accent/20 text-accent"
                  : "text-text-muted hover:bg-ink-700 hover:text-text"
              }`}
            >
              <span>{lv.name}</span>
              <span className="mono text-[10.5px] text-text-faint">K{lv.ordinal}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
