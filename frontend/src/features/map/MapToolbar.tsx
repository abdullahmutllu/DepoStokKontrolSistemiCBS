import {
  Circle,
  MousePointer2,
  Pencil,
  Pentagon,
  Ruler,
  Square,
  Trash2,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  basemapChanged,
  drawingsCleared,
  toolSelected,
  type MapTool,
} from "@/features/map/mapWorkspaceSlice";
import { BASEMAPS } from "@/features/map/mapStyles";
import { formatDistance } from "@/features/map/geometry";
import { cn } from "@/lib/utils";

const TOOLS: { tool: MapTool; label: string; icon: typeof Pentagon }[] = [
  { tool: "pan", label: "Gezin", icon: MousePointer2 },
  { tool: "select", label: "Seç / düzenle", icon: Pencil },
  { tool: "polygon", label: "Poligon çiz", icon: Pentagon },
  { tool: "rectangle", label: "Dikdörtgen çiz", icon: Square },
  { tool: "circle", label: "Daire çiz", icon: Circle },
  { tool: "measure-line", label: "Mesafe ölç", icon: Ruler },
];

export function MapToolbar() {
  const dispatch = useAppDispatch();
  const activeTool = useAppSelector((s) => s.mapWorkspace.activeTool);
  const basemapId = useAppSelector((s) => s.mapWorkspace.basemapId);
  const measure = useAppSelector((s) => s.mapWorkspace.measure);

  return (
    <>
      {/* Vertical tool rail */}
      <div className="absolute left-3 top-3 z-20 flex flex-col gap-1 rounded-md border border-ink-600 bg-ink-850/95 p-1 backdrop-blur">
        {TOOLS.map(({ tool, label, icon: Icon }) => (
          <button
            key={tool}
            title={label}
            aria-label={label}
            aria-pressed={activeTool === tool}
            onClick={() => dispatch(toolSelected(tool))}
            className={cn(
              "flex size-8 items-center justify-center rounded transition-colors",
              activeTool === tool
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:bg-ink-700 hover:text-text",
            )}
          >
            <Icon size={15} strokeWidth={1.75} />
          </button>
        ))}
        <div className="mx-1 my-0.5 border-t border-ink-600" />
        <button
          title="Çizimleri temizle"
          aria-label="Çizimleri temizle"
          onClick={() => dispatch(drawingsCleared())}
          className="flex size-8 items-center justify-center rounded text-text-muted transition-colors hover:bg-status-high/15 hover:text-status-high"
        >
          <Trash2 size={15} strokeWidth={1.75} />
        </button>
      </div>

      {/* Basemap segmented control */}
      <div className="absolute left-14 top-3 z-20 flex gap-0.5 rounded-md border border-ink-600 bg-ink-850/95 p-0.5 backdrop-blur">
        {BASEMAPS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => dispatch(basemapChanged(id))}
            aria-pressed={basemapId === id}
            className={cn(
              "rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
              basemapId === id
                ? "bg-accent/20 text-accent"
                : "text-text-muted hover:bg-ink-700 hover:text-text",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Live measure readout */}
      {measure && (
        <div className="mono absolute bottom-8 left-3 z-20 rounded border border-status-mid/50 bg-ink-900/90 px-2.5 py-1.5 text-[12.5px] text-status-mid backdrop-blur">
          Mesafe: {formatDistance(measure.value)}
        </div>
      )}
    </>
  );
}
