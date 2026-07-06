import { useState } from "react";
import { toast } from "sonner";
import { Radio, RouteOff, Truck, Waypoints } from "lucide-react";
import { useAppDispatch } from "@/app/hooks";
import {
  useActiveShipmentsQuery,
  useClearShipmentsMutation,
  useCreateShipmentsMutation,
  useVehicleRoutesMutation,
} from "@/api/endpoints/logistics";
import { useWarehousesQuery } from "@/api/endpoints/warehouses";
import { toursPreviewed } from "@/features/map/mapWorkspaceSlice";
import { tourColor } from "@/features/map/trackingLayers";
import { apiErrorMessage } from "@/lib/apiError";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { MonoCell } from "@/components/shared/table";
import type { VehicleRoutes } from "@/types";

const STATUS_LABELS: Record<string, string> = {
  pending: "Çıkış bekliyor",
  en_route: "Yolda",
  at_stop: "Teslimatta",
  completed: "Tamamlandı",
};

function etaText(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min < 60) return `${Math.max(0, Math.round(min))} dk`;
  return `${Math.floor(min / 60)} sa ${Math.round(min % 60)} dk`;
}

/** Teslimat planlama + canlı filo takibi: VRP turları üret → sevkiyata çevir →
 * araçları haritada canlı izle (WS push, olmazsa 3 sn poll). */
export function LogisticsPanel() {
  const dispatch = useAppDispatch();
  const warehouses = useWarehousesQuery();
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [vehicleCount, setVehicleCount] = useState(3);
  const [capacity, setCapacity] = useState(60);
  const [preview, setPreview] = useState<VehicleRoutes | null>(null);

  const [planTours, planState] = useVehicleRoutesMutation();
  const [startShipments, startState] = useCreateShipmentsMutation();
  const [clearShipments] = useClearShipmentsMutation();
  // Abonelik MapWorkspacePage'de; burada yalnız önbellekten okunur.
  const shipments = useActiveShipmentsQuery().data ?? [];
  const transport = import.meta.env.VITE_DEMO === "1" ? "poll" : "ws";
  const hasLive = shipments.length > 0;
  const selectedWh = warehouseId ?? warehouses.data?.[0]?.id ?? null;

  const plan = async () => {
    if (selectedWh == null) return;
    try {
      const result = await planTours({
        warehouse_id: selectedWh,
        vehicle_count: vehicleCount,
        capacity,
      }).unwrap();
      setPreview(result);
      dispatch(toursPreviewed({ warehouseId: selectedWh, tours: result.tours }));
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  const start = async () => {
    if (!preview) return;
    try {
      await startShipments({
        warehouse_id: preview.warehouse_id,
        tours: preview.tours,
      }).unwrap();
      setPreview(null);
      dispatch(toursPreviewed(null));
      toast.success("Sevkiyat başladı — araçlar haritada canlı izleniyor (30× hız).");
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  return (
    <div className="space-y-4">
      {/* Planlama */}
      <div className="rounded-md border border-ink-600 bg-ink-800 p-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-text-muted">
          <Waypoints size={12} /> Teslimat turları planla (VRP)
        </h3>
        <div className="space-y-1.5">
          <Select
            value={selectedWh ?? ""}
            onChange={(e) => setWarehouseId(Number(e.target.value))}
            aria-label="Çıkış deposu"
          >
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
          <div className="flex gap-1.5">
            <Select
              value={vehicleCount}
              onChange={(e) => setVehicleCount(Number(e.target.value))}
              aria-label="Araç sayısı"
              className="flex-1"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} araç
                </option>
              ))}
            </Select>
            <Select
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              aria-label="Araç kapasitesi"
              className="flex-1"
            >
              {[30, 45, 60, 90, 120].map((c) => (
                <option key={c} value={c}>
                  {c} birim
                </option>
              ))}
            </Select>
          </div>
          <Button className="w-full" onClick={() => void plan()} disabled={planState.isLoading}>
            {planState.isLoading ? "Hesaplanıyor…" : "Turları hesapla"}
          </Button>
        </div>
      </div>

      {/* Tur önizlemesi */}
      {preview && (
        <div className="space-y-1.5" data-testid="tour-preview">
          {preview.tours.map((tour, i) => (
            <div
              key={tour.vehicle_name}
              className="rounded border border-ink-600 bg-ink-800 px-2.5 py-2"
              style={{ borderLeft: `3px solid ${tourColor(i)}` }}
            >
              <div className="flex items-center justify-between text-[12.5px] font-medium">
                {tour.vehicle_name}
                <MonoCell className="text-[11px] text-text-muted">
                  {tour.stops.length} durak · {tour.distance_km} km · {etaText(tour.duration_min)}
                </MonoCell>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-text-faint">
                {tour.stops.map((s) => s.name).join(" → ")}
              </div>
            </div>
          ))}
          <p className="text-[11px] text-text-faint">{preview.note}</p>
          <Button className="w-full" onClick={() => void start()} disabled={startState.isLoading}>
            <Truck size={13} /> Sevkiyatı başlat ({preview.tours.length} araç)
          </Button>
        </div>
      )}

      {/* Canlı filo */}
      {hasLive && (
        <div className="space-y-1.5" data-testid="live-fleet">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-faint">
              <Radio size={11} className="text-status-low" /> Canlı filo
              <span className="mono rounded bg-ink-800 px-1.5 py-0.5 text-[9.5px]">
                {transport === "ws" ? "WebSocket" : "3 sn poll"} · 30× sim
              </span>
            </h3>
            <button
              onClick={() => void clearShipments()}
              className="flex items-center gap-1 text-[11px] text-text-faint hover:text-status-high"
            >
              <RouteOff size={11} /> Temizle
            </button>
          </div>
          {shipments.map((s, i) => (
            <div
              key={s.id}
              className="rounded border border-ink-600 bg-ink-800 px-2.5 py-2"
              style={{ borderLeft: `3px solid ${tourColor(i)}` }}
            >
              <div className="flex items-center justify-between text-[12.5px]">
                <span className="font-medium">{s.vehicle_name}</span>
                <span
                  className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{
                    backgroundColor:
                      s.live.status === "completed" ? "#3fb97022" : `${tourColor(i)}22`,
                    color: s.live.status === "completed" ? "#3fb970" : tourColor(i),
                  }}
                >
                  {STATUS_LABELS[s.live.status]}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink-600">
                <div
                  className="h-full rounded-full transition-[width] duration-1000"
                  style={{
                    width: `${s.live.progress_percent}%`,
                    backgroundColor: tourColor(i),
                  }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-text-muted">
                <span>
                  {s.live.status === "at_stop" && s.live.current_stop
                    ? `Teslimat: ${s.live.current_stop}`
                    : s.live.next_stop
                      ? `Sıradaki: ${s.live.next_stop}`
                      : "Depoya dönüş"}
                </span>
                <MonoCell className="text-[10.5px]">
                  {s.live.next_stop
                    ? `ETA ${etaText(s.live.next_stop_eta_min)}`
                    : `dönüş ${etaText(s.live.eta_return_min)}`}
                </MonoCell>
              </div>
              <div className="mt-0.5 flex items-center justify-between text-[10.5px] text-text-faint">
                <span>
                  {s.live.completed_stops}/{s.stop_count} teslim · {s.live.speed_kmh} km/sa
                </span>
                <MonoCell className="text-[10px]">{s.total_km} km toplam</MonoCell>
              </div>
            </div>
          ))}
        </div>
      )}

      {!preview && !hasLive && (
        <p className="rounded border border-dashed border-ink-600 px-3 py-4 text-center text-[12px] text-text-muted">
          Depo, araç sayısı ve kapasite seçip turları hesaplayın; sevkiyatı
          başlatınca araçlar haritada gerçek zamanlı izlenir — durak bazlı
          ETA, hız ve ilerlemeyle.
        </p>
      )}
    </div>
  );
}
