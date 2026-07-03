import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bookmark, ChevronRight, MapPin, Pentagon, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  useCreateRegionMutation,
  useDeleteRegionMutation,
  useRegionAnalysisMutation,
  useRegionsQuery,
} from "@/api/endpoints/geo";
import { drawingsCleared, ringDrawn } from "@/features/map/mapWorkspaceSlice";
import { formatArea, formatDistance } from "@/features/map/geometry";
import { apiErrorMessage } from "@/lib/apiError";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonoCell } from "@/components/shared/table";
import { LoadingRows } from "@/components/shared/states";
import { Link } from "react-router-dom";

export function AnalysisPanel() {
  const dispatch = useAppDispatch();
  const analysisRing = useAppSelector((s) => s.mapWorkspace.analysisRing);
  const [analyze, analysis] = useRegionAnalysisMutation();
  const regions = useRegionsQuery();
  const [createRegion, createState] = useCreateRegionMutation();
  const [deleteRegion] = useDeleteRegionMutation();
  const [regionName, setRegionName] = useState("");

  // Ring drawn (or loaded) → run the analysis.
  useEffect(() => {
    if (analysisRing && analysisRing.length >= 3) {
      void analyze({ ring: analysisRing });
    }
  }, [analysisRing, analyze]);

  const saveRegion = async () => {
    if (!analysisRing || !regionName.trim()) {
      toast.error("Bölgeye bir ad verin.");
      return;
    }
    try {
      await createRegion({ name: regionName.trim(), ring: analysisRing }).unwrap();
      toast.success(`"${regionName.trim()}" kaydedildi`);
      setRegionName("");
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  const data = analysis.data;

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col overflow-y-auto border-l border-ink-600 bg-ink-850">
      <div className="border-b border-ink-600 px-4 py-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-text-muted">
          Bölge Analizi
        </h2>
      </div>

      <div className="flex-1 space-y-4 p-4">
        {!analysisRing ? (
          <div className="rounded-md border border-dashed border-ink-600 px-4 py-8 text-center">
            <Pentagon className="mx-auto mb-2 text-text-faint" size={24} strokeWidth={1.5} />
            <p className="text-[13px] font-medium">Haritada bir bölge çizin</p>
            <p className="mt-1 text-[12px] text-text-muted">
              Soldaki araçlarla poligon, dikdörtgen ya da daire çizin — içindeki depolar burada
              analiz edilir. Kayıtlı bölgeler aşağıdan yüklenir.
            </p>
          </div>
        ) : analysis.isLoading ? (
          <LoadingRows rows={4} />
        ) : analysis.isError ? (
          <p className="text-[12.5px] text-status-high">
            {apiErrorMessage(analysis.error)}
          </p>
        ) : data ? (
          <>
            {/* Stat tiles */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Depo", value: String(data.warehouse_count) },
                { label: "Toplam stok", value: data.total_quantity.toLocaleString("tr-TR") },
                {
                  label: "Doluluk",
                  value: `%${data.occupancy_percent}`,
                  tone:
                    data.occupancy_percent > 85
                      ? "#e25c4a"
                      : data.occupancy_percent >= 60
                        ? "#e0a93e"
                        : "#3fb970",
                },
                {
                  label: "Kritik ürün",
                  value: String(data.low_stock_product_count),
                  tone: data.low_stock_product_count > 0 ? "#e25c4a" : undefined,
                },
                { label: "Bölge alanı", value: formatArea(data.area_m2) },
                {
                  label: "En uzak iki depo",
                  value:
                    data.max_pairwise_distance_m > 0
                      ? formatDistance(data.max_pairwise_distance_m)
                      : "—",
                },
              ].map(({ label, value, tone }) => (
                <div key={label} className="rounded bg-ink-900 px-2.5 py-2">
                  <div className="mono text-[15px] font-medium" style={tone ? { color: tone } : undefined}>
                    {value}
                  </div>
                  <div className="text-[10.5px] uppercase tracking-wide text-text-faint">
                    {label}
                  </div>
                </div>
              ))}
            </div>

            {/* Per-warehouse rows */}
            {data.warehouses.length === 0 ? (
              <p className="rounded border border-ink-600 px-3 py-4 text-center text-[12.5px] text-text-muted">
                Bu bölgede depo yok. Bölgeyi taşıyın ya da yeni bir alan çizin.
              </p>
            ) : (
              <div className="space-y-1.5">
                {data.warehouses.map((w) => (
                  <Link
                    key={w.warehouse_id}
                    to={`/warehouses/${w.warehouse_id}`}
                    className="block rounded border border-ink-600 bg-ink-800 px-3 py-2 transition-colors hover:border-accent/60"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium">{w.warehouse_name}</span>
                      <ChevronRight size={13} className="shrink-0 text-text-faint" />
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-600">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, w.occupancy_percent)}%`,
                          backgroundColor:
                            w.occupancy_percent > 85
                              ? "#e25c4a"
                              : w.occupancy_percent >= 60
                                ? "#e0a93e"
                                : "#3fb970",
                        }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-text-muted">
                      <MonoCell className="text-[11px]">
                        {w.total_quantity} adet · {w.used_bin_count}/{w.bin_count} göz
                      </MonoCell>
                      <span className="mono flex items-center gap-0.5 text-[10.5px] text-text-faint">
                        <MapPin size={10} /> merkeze {formatDistance(w.distance_to_centroid_m)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {/* Save region */}
            <div className="rounded-md border border-ink-600 bg-ink-800 p-3">
              <label htmlFor="region-name" className="mb-1.5 block text-[12px] text-text-muted">
                Bu bölgeyi kaydet
              </label>
              <div className="flex gap-1.5">
                <Input
                  id="region-name"
                  placeholder="Örn. Marmara Bölgesi"
                  value={regionName}
                  onChange={(e) => setRegionName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void saveRegion()}
                />
                <Button
                  onClick={() => void saveRegion()}
                  disabled={createState.isLoading || !regionName.trim()}
                >
                  <Bookmark size={13} /> Kaydet
                </Button>
              </div>
            </div>
          </>
        ) : null}

        {/* Saved regions */}
        <div>
          <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-faint">
            Kayıtlı bölgeler
          </h3>
          {regions.isLoading ? (
            <LoadingRows rows={2} />
          ) : !regions.data || regions.data.length === 0 ? (
            <p className="text-[12px] text-text-muted">
              Henüz kayıtlı bölge yok. Bir bölge çizip ad vererek kaydedin.
            </p>
          ) : (
            <div className="space-y-1">
              {regions.data.map((region) => (
                <div
                  key={region.id}
                  className="flex items-center justify-between gap-2 rounded border border-ink-600 bg-ink-800 px-2.5 py-1.5"
                >
                  <button
                    onClick={() => dispatch(ringDrawn(region.ring))}
                    className="flex-1 truncate text-left text-[12.5px] hover:text-accent"
                    title="Bölgeyi yükle ve analiz et"
                  >
                    {region.name}
                  </button>
                  <button
                    aria-label={`${region.name} bölgesini sil`}
                    onClick={async () => {
                      if (!window.confirm(`"${region.name}" silinsin mi?`)) return;
                      await deleteRegion(region.id);
                      toast.success("Bölge silindi");
                    }}
                    className="rounded p-1 text-text-faint hover:bg-status-high/15 hover:text-status-high"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {analysisRing && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => dispatch(drawingsCleared())}
          >
            Analizi temizle
          </Button>
        )}
      </div>
    </aside>
  );
}
