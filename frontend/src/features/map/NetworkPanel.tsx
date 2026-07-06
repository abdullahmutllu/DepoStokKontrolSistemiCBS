import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Crosshair, FileUp, Pause, Play, PowerOff, X } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  useCenterOfGravityMutation,
  useClosestFacilityQuery,
  useCoverageQuery,
  useCustomersQuery,
  useFlowMapQuery,
  useImportCustomersCsvMutation,
} from "@/api/endpoints/network";
import { useScenarioMutation } from "@/api/endpoints/logistics";
import { useWarehousesQuery } from "@/api/endpoints/warehouses";
import {
  cogComputed,
  flowDayChanged,
  networkLayerToggled,
  scenarioClosed,
  type NetworkLayerToggles,
} from "@/features/map/mapWorkspaceSlice";
import type { ScenarioResult } from "@/types";

/** Son N günün YYYY-MM-DD listesi (eski → yeni). */
function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}
import { apiErrorMessage } from "@/lib/apiError";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { InfoHint } from "@/components/ui/InfoHint";
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
  const flowDay = useAppSelector((s) => s.mapWorkspace.flowDay);
  const scenarioClosedIds = useAppSelector((s) => s.mapWorkspace.scenarioClosedIds);
  const [nSites, setNSites] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);

  const customers = useCustomersQuery();
  const warehouses = useWarehousesQuery();
  const closest = useClosestFacilityQuery(undefined, { skip: !toggles.assignments && !toggles.voronoi });
  const coverage = useCoverageQuery(undefined, { skip: !toggles.coverage });
  const flow = useFlowMapQuery(flowDay ? { day: flowDay } : undefined, { skip: !toggles.flow });
  const [runCog, cogState] = useCenterOfGravityMutation();
  const [importCsv, importState] = useImportCustomersCsvMutation();
  const [runScenario, scenarioState] = useScenarioMutation();
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null);

  // Akış zaman animasyonu: oynatılırken 14 günü 0.9 sn arayla gezer.
  // days günde bir değişir → mount başına bir kez üretilir; başlangıç
  // indeksi ref'te tutulur ki flowDay her tick'te değişince interval sıfırlanmasın.
  const [playing, setPlaying] = useState(false);
  const days = useMemo(() => lastDays(14), []);
  const flowDayRef = useRef(flowDay);
  flowDayRef.current = flowDay;
  useEffect(() => {
    if (!playing) return;
    let idx = flowDayRef.current ? Math.max(0, days.indexOf(flowDayRef.current)) : 0;
    const timer = setInterval(() => {
      idx = (idx + 1) % days.length;
      dispatch(flowDayChanged(days[idx]));
    }, 900);
    return () => clearInterval(timer);
  }, [playing, dispatch, days]);

  const stopAnimation = () => {
    setPlaying(false);
    dispatch(flowDayChanged(null));
  };

  const toggleClosed = (id: number) => {
    const next = scenarioClosedIds.includes(id)
      ? scenarioClosedIds.filter((x) => x !== id)
      : [...scenarioClosedIds, id];
    dispatch(scenarioClosed(next));
    setScenarioResult(null);
  };

  const computeScenario = async () => {
    try {
      const result = await runScenario({
        closed_warehouse_ids: scenarioClosedIds,
      }).unwrap();
      setScenarioResult(result);
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

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
      <p className="flex items-start gap-1.5 text-[12px] leading-snug text-text-muted">
        <InfoHint text="Müşteri noktalarını analiz eder: nerede talep yoğun, hangi müşteri hangi depoya yakın, kapsama dışı kalan var mı, yeni depo nereye kurulmalı." />
        Müşteri ağını çöz: talep, atama, kapsama, yeni depo yeri.
      </p>

      {/* Layer toggles */}
      <div>
        <h3 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-faint">
          Analiz katmanları
          <InfoHint text="Aç/kapat: her katman haritada bir görünüm ekler — talep ısı haritası, en yakın depo çizgileri, hizmet bölgeleri, kapsama halkaları, depolar arası akış." />
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
          <InfoHint text="Müşteri talebine göre en uygun depo konumunu hesaplar. Kaç depo istersen o kadar aday nokta önerir ve toplam taşıma mesafesindeki iyileşmeyi gösterir." />
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

      {/* Flow: zaman animasyonu */}
      {toggles.flow && (
        <div className="rounded-md border border-ink-600 bg-ink-800 p-3" data-testid="flow-anim">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-faint">
              Akış animasyonu · 14 gün
              <InfoHint text="Son 14 günde depolar arası transfer hareketini gün gün oynatır. Ok kalınlığı taşınan miktarı gösterir." />
            </h3>
            <div className="flex items-center gap-1">
              <button
                aria-label={playing ? "Duraklat" : "Oynat"}
                onClick={() => (playing ? setPlaying(false) : setPlaying(true))}
                className="rounded p-1 text-text-muted hover:bg-ink-700 hover:text-accent"
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}
              </button>
              {flowDay && (
                <button
                  onClick={stopAnimation}
                  className="rounded p-1 text-text-faint hover:text-status-high"
                  aria-label="Animasyonu sıfırla"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={days.length - 1}
            value={flowDay ? Math.max(0, days.indexOf(flowDay)) : days.length - 1}
            onChange={(e) => {
              setPlaying(false);
              dispatch(flowDayChanged(days[Number(e.target.value)]));
            }}
            className="mt-2 w-full accent-[#5e8bff]"
            aria-label="Gün seç"
          />
          <div className="mt-1 flex items-center justify-between text-[10.5px] text-text-faint">
            <span className="mono">{flowDay ?? "Tüm günler (toplam)"}</span>
            <span>{flow.data?.arcs.length ?? 0} akış</span>
          </div>
        </div>
      )}
      {toggles.flow && !flowDay && flow.data && flow.data.arcs.length === 0 && (
        <p className="text-[12px] text-text-muted">
          Depolar arası transfer kaydı yok — Stok İşlemleri'nden transfer yapınca akış burada çizilir.
        </p>
      )}

      {/* What-if: depo kapatma senaryosu */}
      <div className="rounded-md border border-ink-600 bg-ink-800 p-3" data-testid="scenario-card">
        <h3 className="mb-2 flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-text-muted">
          <PowerOff size={12} /> What-if: depo kapat
          <InfoHint text="Bir depoyu kapatsan ne olur? Müşteriler en yakın açık depoya taşınır; toplam mesafe ve kapsama nasıl değişir görürsün." />
        </h3>
        <div className="space-y-1">
          {(warehouses.data ?? []).map((w) => (
            <label
              key={w.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[12px] hover:bg-ink-700/50"
            >
              <input
                type="checkbox"
                checked={scenarioClosedIds.includes(w.id)}
                onChange={() => toggleClosed(w.id)}
                className="accent-[#e25c4a]"
              />
              <span className={scenarioClosedIds.includes(w.id) ? "line-through opacity-60" : ""}>
                {w.name}
              </span>
            </label>
          ))}
        </div>
        <Button
          className="mt-2 w-full"
          variant="secondary"
          onClick={() => void computeScenario()}
          disabled={scenarioClosedIds.length === 0 || scenarioState.isLoading}
        >
          {scenarioState.isLoading ? "Hesaplanıyor…" : "Senaryoyu hesapla"}
        </Button>

        {scenarioResult && (
          <div className="mt-3 space-y-2" data-testid="scenario-result">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded bg-ink-900 px-2 py-1.5">
                <div className="mono text-[13px]">
                  {scenarioResult.baseline.total_weighted_km.toLocaleString("tr-TR")} km
                </div>
                <div className="text-[10px] uppercase tracking-wide text-text-faint">Mevcut ağ</div>
              </div>
              <div className="rounded bg-ink-900 px-2 py-1.5">
                <div
                  className="mono text-[13px]"
                  style={{ color: scenarioResult.delta_weighted_km > 0 ? "#e25c4a" : "#3fb970" }}
                >
                  {scenarioResult.scenario.total_weighted_km.toLocaleString("tr-TR")} km
                </div>
                <div className="text-[10px] uppercase tracking-wide text-text-faint">Senaryo</div>
              </div>
            </div>
            <p className="text-[12px]">
              Ağırlıklı taşıma mesafesi{" "}
              <span
                className="mono font-medium"
                style={{ color: scenarioResult.delta_percent > 0 ? "#e25c4a" : "#3fb970" }}
              >
                %{Math.abs(scenarioResult.delta_percent)}
              </span>{" "}
              {scenarioResult.delta_percent > 0 ? "artar" : "azalır"};{" "}
              <span className="mono">{scenarioResult.reassigned_customers}</span> müşteri başka
              depoya taşınır, kapsama dışı{" "}
              <span className="mono">
                {scenarioResult.baseline.uncovered_customers}→
                {scenarioResult.scenario.uncovered_customers}
              </span>
              .
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setScenarioResult(null);
                dispatch(scenarioClosed([]));
              }}
            >
              <X size={12} /> Senaryoyu temizle
            </Button>
          </div>
        )}
      </div>

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
