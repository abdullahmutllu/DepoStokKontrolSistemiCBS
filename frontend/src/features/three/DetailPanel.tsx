import { AlertTriangle, X } from "lucide-react";
import { useLocationDetailQuery } from "@/api/endpoints/warehouses";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { binSelected } from "@/features/three/selectionSlice";
import { OccupancyBadge } from "@/components/ui/badge";
import { occupancyBucket, occupancyRatio } from "@/features/three/occupancy";
import { LoadingRows } from "@/components/shared/states";
import { DataTable, THead, Th, Tr, Td, MonoCell } from "@/components/shared/table";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/apiError";

/** Regular DOM panel next to the canvas: contents of the clicked bin. */
export function DetailPanel() {
  const dispatch = useAppDispatch();
  const selectedId = useAppSelector((s) => s.selection.selectedId);
  const alert = useAppSelector((s) => s.selection.selectedAlert);
  const { data, isLoading, isError, error, refetch } = useLocationDetailQuery(
    selectedId ?? 0,
    { skip: selectedId == null },
  );

  if (selectedId == null) return null;

  const alertColor = alert?.level === "critical" ? "#e25c4a" : "#e0a93e";

  return (
    <div className="absolute right-3 top-3 z-10 w-72 rounded-md border border-ink-600 bg-ink-800/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-ink-600 px-3 py-2">
        <MonoCell className="text-[13px] font-medium text-accent-glow">
          {data?.code ?? "…"}
        </MonoCell>
        <button
          onClick={() => dispatch(binSelected(null))}
          className="rounded p-0.5 text-text-muted hover:bg-ink-700 hover:text-text"
          aria-label="Paneli kapat"
        >
          <X size={14} />
        </button>
      </div>
      {alert && (
        <div
          className="flex items-start gap-2 border-b border-ink-600 px-3 py-2"
          style={{ backgroundColor: `${alertColor}18` }}
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: alertColor }} />
          <p className="text-[12px] leading-snug text-text">
            <span className="mono font-medium" style={{ color: alertColor }}>
              {alert.sku}
            </span>{" "}
            {alert.level === "critical" ? "kritik seviyede" : "azalıyor"}: org geneli toplam{" "}
            <span className="mono">
              {alert.total}/{alert.threshold}
            </span>
            . Bu ürün için yeni sipariş verilmeli.
          </p>
        </div>
      )}
      <div className="p-3">
        {isError ? (
          <div className="space-y-2">
            <p className="text-[12.5px] text-status-high">{apiErrorMessage(error)}</p>
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              Tekrar dene
            </Button>
          </div>
        ) : isLoading || !data ? (
          <LoadingRows rows={2} />
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <OccupancyBadge
                bucket={occupancyBucket(data.total_quantity, data.capacity)}
                percent={
                  data.capacity
                    ? occupancyRatio(data.total_quantity, data.capacity) * 100
                    : undefined
                }
              />
              <span className="mono text-[12px] text-text-muted">
                {data.total_quantity}
                {data.capacity ? `/${data.capacity}` : ""} adet
              </span>
            </div>
            {data.stock.length === 0 ? (
              <p className="py-2 text-[12.5px] text-text-muted">
                Bu göz boş. Stok İşlemleri sayfasından mal kabul yapabilirsiniz.
              </p>
            ) : (
              <DataTable>
                <THead>
                  <Th>SKU</Th>
                  <Th>Ürün</Th>
                  <Th className="text-right">Miktar</Th>
                </THead>
                <tbody>
                  {data.stock.map((s) => (
                    <Tr key={s.product_id}>
                      <Td>
                        <MonoCell>{s.sku}</MonoCell>
                      </Td>
                      <Td className="max-w-28 truncate" >{s.product_name}</Td>
                      <Td className="text-right">
                        <MonoCell>
                          {s.quantity} {s.unit}
                        </MonoCell>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
