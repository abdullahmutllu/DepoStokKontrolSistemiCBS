import { Link } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import type { Warehouse } from "@/types";
import { MonoCell } from "@/components/shared/table";
import { OccupancyBadge } from "@/components/ui/badge";
import { occupancyBucket } from "@/features/three/occupancy";

/** Rich warehouse card anchored over the map. Pure presentational. */
export function WarehousePopup({
  warehouse,
  onClose,
}: {
  warehouse: Warehouse;
  onClose: () => void;
}) {
  const pct = warehouse.occupancy_percent;
  const bucket =
    pct == null || (warehouse.bin_count ?? 0) === 0
      ? "empty"
      : occupancyBucket(Math.round(pct), 100);

  return (
    <div
      data-testid="warehouse-popup"
      className="w-72 rounded-md border border-ink-600 bg-ink-800/95 shadow-xl backdrop-blur"
    >
      <div className="flex items-start justify-between gap-2 border-b border-ink-600 px-3 py-2">
        <div>
          <div className="text-[13.5px] font-semibold leading-tight">{warehouse.name}</div>
          {warehouse.address && (
            <div className="mt-0.5 text-[11.5px] text-text-muted">{warehouse.address}</div>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Kartı kapat"
          className="rounded p-0.5 text-text-muted hover:bg-ink-700 hover:text-text"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-2.5 p-3">
        <div className="flex items-center justify-between">
          <OccupancyBadge bucket={bucket} percent={pct ?? undefined} />
          <MonoCell className="text-[11.5px] text-text-muted">
            {warehouse.local_width}×{warehouse.local_depth} m
          </MonoCell>
        </div>

        {pct != null && (
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-600">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, pct)}%`,
                backgroundColor: pct > 85 ? "#e25c4a" : pct >= 60 ? "#e0a93e" : "#3fb970",
              }}
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-1.5 text-center">
          {[
            { label: "Göz", value: warehouse.bin_count ?? 0 },
            { label: "Ürün", value: warehouse.product_count ?? 0 },
            { label: "Stok", value: warehouse.total_quantity ?? 0 },
          ].map(({ label, value }) => (
            <div key={label} className="rounded bg-ink-900 px-1.5 py-1">
              <div className="mono text-[13.5px] font-medium">{value}</div>
              <div className="text-[10px] uppercase tracking-wide text-text-faint">{label}</div>
            </div>
          ))}
        </div>

        <Link
          to={`/warehouses/${warehouse.id}`}
          className="flex items-center justify-center gap-1 rounded bg-accent/15 py-1.5 text-[12.5px] font-medium text-accent transition-colors hover:bg-accent/25"
        >
          Depoya git <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}
