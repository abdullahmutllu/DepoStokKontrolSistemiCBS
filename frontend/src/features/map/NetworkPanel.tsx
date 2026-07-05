import { useRef, useState } from "react";
import { toast } from "sonner";
import { Crosshair, FileUp, X } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  useCenterOfGravityMutation,
  useClosestFacilityQuery,
  useCoverageQuery,
  useCustomersQuery,
  useFlowMapQuery,
  useImportCustomersCsvMutation,
} from "@/api/endpoints/network";
import {
  cogComputed,
  networkLayerToggled,
  type NetworkLayerToggles,
} from "@/features/map/mapWorkspaceSlice";
import { apiErrorMessage } from "@/lib/apiError";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { MonoCell } from "@/components/shared/table";
import { LoadingRows } from "@/components/shared/states";

const LAYER_DEFS: { key: keyof NetworkLayerToggles; label: string; hint: string }[] = [
  { key: "customers", label: "Müşteri noktaları", hint: "ağırlıkla ölçekli" },
  { key: "heatmap", label: "Talep ısı haritası", hint: "yoğunluk" },
  { key: "assignments", label: "En yakın depo ataması", hint: "örümcek çizgiler" },
  { key: "voronoi", label: "Hizmet bölgeleri", hint: "Voronoi" },
  { key: "coverage", label: "Kapsama alanları", hint: "halkalar / isochrone" },
  { key: "flow", label: "Depolar arası akış", hint: "transfer hacmi" },
];

export function NetworkPanel() {
  const dispatch = useAppDispatch();
  const toggles = useAppSelector((s) => s.mapWorkspace.networkLayers);
  const cogResult = useAppSelector((s) => s.mapWorkspace.cogResult);
  const [nSites, setNSites] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  const customers = useCustomersQuery();
  const closest = useClosestFacilityQuery(undefined, { skip: !toggles.assignments && !toggles.voronoi });
  const coverage = useCoverageQuery(undefined, { skip: !toggles.coverage });
  const flow = useFlowMapQuery(undefined, { skip: !toggles.flow });
  const [runCog, cogState] = useCenterOfGravityMutation();
  const [importCsv, importState] = useImportCustomersCsvMutation();

  const computeCog = async () => {
    try {
      const result = await runCog({ n_sites: nSites }).unwrap();
      dispatch(cogComputed(result));
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await importCsv(file).unwrap();
      toast.success(`Müşteri CSV: ${result.created} yeni, ${result.updated} güncellendi`);
      result.errors.slice(0, 3).forEach((e) => toast.warning(e));
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-4">
      {/* Layer toggles */}
      <div>
        <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-faint">
          Analiz katmanları
        </h3>
        <div className="space-y-1">
          {LAYER_DEFS.map(({ key, label, hint }) => (
            <label
              key={key}
              className="flex cursor-pointer items-center justify-between rounded border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-[12.5px] hover:border-accent/50"
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={toggles[key]}
                  onChange={() => dispatch(networkLayerToggled(key))}
                  className="accent-[#5e8bff]"
                />
                {label}
              </span>
              <span className="text-[10.5px] text-text-faint">{hint}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Coverage mode note */}
      {toggles.coverage && coverage.data && (
        <p className="rounded border border-ink-600 bg-ink-900 px-2.5 py-1.5 text-[11.5px] text-text-muted">
          {coverage.data.note}
          {coverage.data.uncovered_customers > 0 && (
            <>
              {" — "}
              <span className="text-status-mid">
                {coverage.data.uncovered_customers} müşteri kapsama dışı
              </span>
            </>
          )}
        </p>
      )}

      {/* Center of gravity */}
      <div className="rounded-md border border-ink-600 bg-ink-800 p-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-text-muted">
          <Crosshair size={12} /> Yeni depo öner (ağırlık merkezi)
        </h3>
        <div className="flex gap-1.5">
          <Select
            value={nSites}
            onChange={(e) => setNSites(Number(e.target.value))}
            className="w-24"
            aria-label="Önerilecek depo sayısı"
          >
            <option value={1}>1 depo</option>
            <option value={2}>2 depo</option>
            <option value={3}>3 depo</option>
          </Select>
          <Button className="flex-1" onClick={() => void computeCog()} disabled={cogState.isLoading}>
            {cogState.isLoading ? "Hesaplanıyor…" : "Analiz et"}
          </Button>
        </div>

        {cogResult && (
          <div className="mt-3 space-y-2" data-testid="cog-result">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded bg-ink-900 px-2 py-1.5">
                <div className="mono text-[14px]">{cogResult.current_total_weighted_km.toLocaleString("tr-TR")} km</div>
                <div className="text-[10px] uppercase tracking-wide text-text-faint">Mevcut ağırlıklı mesafe</div>
              </div>
              <div className="rounded bg-ink-900 px-2 py-1.5">
                <div className="mono text-[14px] text-status-low">
                  {cogResult.proposed_total_weighted_km.toLocaleString("tr-TR")} km
                </div>
                <div className="text-[10px] uppercase tracking-wide text-text-faint">Önerilen ile</div>
              </div>
            </div>
            {cogResult.improvement_percent >= 0 ? (
              <p className="text-[12.5px]">
                Önerilen {cogResult.n_sites} konum, ağırlıklı taşıma mesafesini{" "}
                <span className="mono font-medium text-status-low">
                  %{cogResult.improvement_percent}
                </span>{" "}
                azaltır.
              </p>
            ) : (
              <p className="text-[12.5px] text-text-muted">
                Önerilen {cogResult.n_sites} konum mevcut depo ağının{" "}
                <span className="mono font-medium text-status-mid">
                  %{Math.abs(cogResult.improvement_percent)}
                </span>{" "}
                gerisinde kalıyor — aday sayısını artırmayı deneyin.
              </p>
            )}
            {cogResult.proposed_sites.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-[11.5px] text-text-muted">
                <span>
                  Aday {i + 1}: <MonoCell>{s.location.lat.toFixed(4)}, {s.location.lng.toFixed(4)}</MonoCell>
                </span>
                <span className="mono">{s.assigned_weight} talep</span>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => dispatch(cogComputed(null))}
            >
              <X size={12} /> Öneriyi temizle
            </Button>
          </div>
        )}
      </div>

      {/* Facility loads (when assignments visible) */}
      {toggles.assignments && (
        closest.isLoading ? (
          <LoadingRows rows={2} />
        ) : closest.data ? (
          <div>
            <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-faint">
              Depo yükleri (en yakın atama)
            </h3>
            <div className="space-y-1">
              {closest.data.loads.map((ld) => (
                <div
                  key={ld.warehouse_id}
                  className="flex items-center justify-between rounded border border-ink-600 bg-ink-800 px-2.5 py-1.5 text-[12px]"
                >
                  <span className="truncate">{ld.warehouse_name}</span>
                  <MonoCell className="text-[11px] text-text-muted">
                    {ld.customer_count} müşteri · {ld.total_weight} talep · ort {ld.avg_distance_km} km
                  </MonoCell>
                </div>
              ))}
            </div>
          </div>
        ) : null
      )}

      {/* Flow summary */}
      {toggles.flow && flow.data && flow.data.arcs.length === 0 && (
        <p className="text-[12px] text-text-muted">
          Depolar arası transfer kaydı yok — Stok İşlemleri'nden transfer yapınca akış burada çizilir.
        </p>
      )}

      {/* Customers row */}
      <div className="flex items-center justify-between rounded border border-ink-600 bg-ink-800 px-2.5 py-2">
        <span className="text-[12.5px] text-text-muted">
          <MonoCell>{customers.data?.length ?? "…"}</MonoCell> müşteri noktası
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => void onImport(e.target.files?.[0])}
        />
        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={importState.isLoading}>
          <FileUp size={12} /> CSV içe aktar
        </Button>
      </div>
    </div>
  );
}
