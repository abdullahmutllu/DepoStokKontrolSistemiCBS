import { useEffect, useMemo, useState } from "react";
import { Footprints, Search, Sparkles, X } from "lucide-react";
import { useLayout3dQuery } from "@/api/endpoints/warehouses";
import { useLazyFindProductQuery } from "@/api/endpoints/stock";
import { useProductsQuery } from "@/api/endpoints/products";
import { useSlottingMutation } from "@/api/endpoints/ai";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { binSelected, binsHighlighted, highlightsCleared } from "@/features/three/selectionSlice";
import { buildSceneModel, cameraPresets, type CameraPreset } from "@/features/three/sceneModel";
import {
  WarehouseScene,
  type ColorMode,
  type ViewMode,
} from "@/features/three/WarehouseScene";
import { DetailPanel } from "@/features/three/DetailPanel";
import { PickRoutePanel } from "@/features/three/PickRoutePanel";
import {
  ABC_COLORS,
  ABC_LEGEND,
  OCCUPANCY_COLORS,
  OCCUPANCY_LEGEND,
} from "@/features/three/occupancy";
import type { PickRoute, PolicyRoute } from "@/types";
import { EmptyState, ErrorState, LoadingRows } from "@/components/shared/states";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/InfoHint";
import type { SlottingSuggestion } from "@/types";
import { apiErrorMessage } from "@/lib/apiError";
import { toast } from "sonner";

export function Warehouse3DTab({ warehouseId }: { warehouseId: number }) {
  const dispatch = useAppDispatch();
  const { data, isLoading, isError, error, refetch } = useLayout3dQuery(warehouseId);
  const [query, setQuery] = useState("");
  const [findProduct, findState] = useLazyFindProductQuery();
  const highlightedIds = useAppSelector((s) => s.selection.highlightedIds);
  const [presetRequest, setPresetRequest] = useState<CameraPreset | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("analytic");
  const [colorMode, setColorMode] = useState<ColorMode>("occupancy");
  const [pickRoute, setPickRoute] = useState<PickRoute | null>(null);
  const [policy, setPolicy] = useState<PolicyRoute["policy"]>("optimized");
  const [walkMode, setWalkMode] = useState(false);
  const [walkLocked, setWalkLocked] = useState(false);
  const [slotProductId, setSlotProductId] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<SlottingSuggestion[]>([]);
  const products = useProductsQuery({ page_size: 100 });
  const [runSlotting, slottingState] = useSlottingMutation();

  const suggest = async () => {
    const pid = slotProductId ?? products.data?.items[0]?.id;
    if (pid == null) return;
    try {
      const result = await runSlotting({ product_id: pid, warehouse_id: warehouseId }).unwrap();
      setSuggestions(result.suggestions);
      dispatch(binsHighlighted(result.suggestions.map((s) => s.location_id)));
      if (result.suggestions[0]) {
        toast.success(`Öneri: ${result.suggestions[0].code} — ${result.suggestions[0].reason}`);
      } else {
        toast.info("Uygun boş göz bulunamadı.");
      }
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  const model = useMemo(() => (data ? buildSceneModel(data) : null), [data]);
  const presets = useMemo(() => (model ? cameraPresets(model.floor) : []), [model]);
  const activeRoute = pickRoute?.routes.find((r) => r.policy === policy) ?? null;

  // Leaving the tab clears spatial selection state.
  useEffect(() => () => void dispatch(highlightsCleared()), [dispatch]);

  const runSearch = async () => {
    const q = query.trim();
    if (!q) return;
    const rows = await findProduct(q).unwrap();
    const inThisWarehouse = rows.filter((r) => r.warehouse_id === warehouseId);
    dispatch(binsHighlighted(inThisWarehouse.map((r) => r.location_id)));
    if (inThisWarehouse.length === 0) {
      toast.info(
        rows.length > 0
          ? "Bu üründen bu depoda yok; diğer depolarda bulundu."
          : "Ürün stokta bulunamadı.",
      );
    }
  };

  if (isLoading) return <LoadingRows rows={6} />;
  if (isError) return <ErrorState message={apiErrorMessage(error)} onRetry={refetch} />;
  if (!data || !model || model.bins.length === 0) {
    return (
      <EmptyState
        title="Yerleşim yok"
        hint="Önce Yerleşim sekmesinde raf yerleştirin ya da DXF planı içe aktarın; 3B görünüm buradan otomatik türetilir."
      />
    );
  }

  return (
    <div>
      {/* Search → highlight */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-72 max-w-full">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void runSearch()}
            placeholder="Ürün ara: SKU, ad veya barkod"
            className="pl-8"
            aria-label="Ürün ara"
          />
        </div>
        <Button variant="secondary" onClick={() => void runSearch()} disabled={findState.isFetching}>
          {findState.isFetching ? "Aranıyor…" : "3B'de göster"}
        </Button>
        {highlightedIds.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => dispatch(highlightsCleared())}>
            <X size={13} /> Vurguyu temizle ({highlightedIds.length} göz)
          </Button>
        )}
      </div>

      {/* Pick-route planner */}
      <PickRoutePanel
        warehouseId={warehouseId}
        model={model}
        highlightedIds={highlightedIds}
        result={pickRoute}
        onResult={setPickRoute}
        policy={policy}
        onPolicyChange={setPolicy}
      />

      {/* AI yerleştirme önerisi: boş gözler sahnede parlar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-ink-600 bg-ink-850 px-3 py-2">
        <span className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-text-muted">
          <Sparkles size={13} /> Yerleştirme önerisi
          <InfoHint text="Bir ürün seç, 'Göz öner'e bas. Sistem o ürünü koymak için en uygun boş gözleri önerir (kapıya yakın, kolay erişilen) ve sahnede parlatır." />
        </span>
        <Select
          value={slotProductId ?? products.data?.items[0]?.id ?? ""}
          onChange={(e) => setSlotProductId(Number(e.target.value))}
          aria-label="Yerleştirilecek ürün"
          className="w-56"
        >
          {(products.data?.items ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.sku} — {p.name}
            </option>
          ))}
        </Select>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void suggest()}
          disabled={slottingState.isLoading}
        >
          {slottingState.isLoading ? "Değerlendiriliyor…" : "Göz öner"}
        </Button>
        {suggestions.map((s, i) => (
          <button
            key={s.location_id}
            onClick={() => dispatch(binSelected(s.location_id))}
            title={s.reason}
            className={`mono rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
              i === 0
                ? "border-status-low bg-status-low/15 text-status-low"
                : "border-ink-600 bg-ink-800 text-text-muted hover:border-accent/60"
            }`}
          >
            {i === 0 ? "★ " : ""}
            {s.code}
          </button>
        ))}
        {suggestions.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSuggestions([]);
              dispatch(highlightsCleared());
            }}
          >
            <X size={12} />
          </Button>
        )}
      </div>

      {/* The scene */}
      <div className="relative h-[520px] overflow-hidden rounded-md border border-ink-600 bg-ink-950">
        <WarehouseScene
          model={model}
          presetRequest={presetRequest}
          onPresetArrived={() => setPresetRequest(null)}
          viewMode={viewMode}
          colorMode={colorMode}
          route={activeRoute}
          walkMode={walkMode}
          onWalkExit={() => {
            setWalkMode(false);
            setWalkLocked(false);
          }}
          onWalkLock={() => setWalkLocked(true)}
        />
        {/* Yürüyüş modu: pointer lock kullanıcı tıklaması ister */}
        {walkMode && !walkLocked && (
          <button
            id="walk-start"
            className="absolute inset-0 z-20 grid place-items-center bg-ink-950/70 backdrop-blur-[2px]"
          >
            <span className="rounded-md border border-ink-600 bg-ink-900 px-4 py-3 text-center text-[13px] text-text">
              <Footprints className="mx-auto mb-1.5 text-accent" size={20} />
              <span className="font-medium">Yürüyüş moduna girmek için tıklayın</span>
              <span className="mt-1 block text-[11.5px] text-text-muted">
                WASD / ok tuşları: hareket · Shift: koşu · fare: bakış · ESC: çıkış
              </span>
            </span>
          </button>
        )}
        <DetailPanel />
        {/* Aktif toplama rotası açıklaması — beacon renklerini anlatır */}
        {activeRoute && (
          <div className="pointer-events-none absolute left-1/2 top-12 z-10 -translate-x-1/2 rounded-md border border-ink-600 bg-ink-900/90 px-3 py-1.5 text-[11.5px] backdrop-blur">
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
              <span className="font-medium text-accent-glow">
                Toplama rotası · {activeRoute.stops.length} durak · {activeRoute.total_m.toLocaleString("tr-TR")} m
              </span>
              <span className="flex items-center gap-1.5 text-text-muted">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: "#3fb970" }} />
                kapı (başla/bitiş)
              </span>
              <span className="flex items-center gap-1.5 text-text-muted">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: "#5e8bff" }} />
                numaralı toplama sırası
              </span>
              <span className="flex items-center gap-1.5 text-text-muted">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: "#e0a93e" }} />
                son durak
              </span>
            </div>
          </div>
        )}
        {/* Camera presets + view mode */}
        <div className="absolute left-3 top-3 flex items-center gap-2">
          <div className="flex gap-0.5 rounded border border-ink-600 bg-ink-900/90 p-0.5 backdrop-blur">
            {presets
              .filter((p) => p.id !== "reset")
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPresetRequest(p)}
                  className="rounded px-2 py-1 text-[11.5px] font-medium text-text-muted transition-colors hover:bg-ink-700 hover:text-text"
                >
                  {p.label}
                </button>
              ))}
          </div>
          <div
            className="flex gap-0.5 rounded border border-ink-600 bg-ink-900/90 p-0.5 backdrop-blur"
            role="radiogroup"
            aria-label="Görünüm modu"
          >
            {(
              [
                { id: "analytic", label: "Analitik" },
                { id: "realistic", label: "Gerçekçi" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                role="radio"
                aria-checked={viewMode === id}
                onClick={() => setViewMode(id)}
                className={`rounded px-2 py-1 text-[11.5px] font-medium transition-colors ${
                  viewMode === id
                    ? "bg-accent/20 text-accent"
                    : "text-text-muted hover:bg-ink-700 hover:text-text"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center rounded border border-ink-600 bg-ink-900/90 px-1.5 backdrop-blur">
            <InfoHint text="Analitik: göz renkleri ve yükseklikleri veriyi gösterir. Gerçekçi: paletler, koliler ve ışıklandırmayla fotoğrafik görünüm." />
          </div>
          <button
            onClick={() => setWalkMode((v) => !v)}
            aria-pressed={walkMode}
            title="WASD ve fareyle depo içinde ilk şahıs gez"
            className={`flex items-center gap-1 rounded border border-ink-600 bg-ink-900/90 px-2 py-1 text-[11.5px] font-medium backdrop-blur transition-colors ${
              walkMode ? "text-accent" : "text-text-muted hover:text-text"
            }`}
          >
            <Footprints size={12} /> Yürüyüş
          </button>
        </div>
        {/* Legend — the color scale is data, keep it visible */}
        <div className="absolute bottom-3 left-3 flex items-center gap-3 rounded border border-ink-600 bg-ink-900/90 px-2.5 py-1.5 backdrop-blur">
          <div className="flex gap-0.5 rounded bg-ink-800 p-0.5" role="radiogroup" aria-label="Renk modu">
            {(
              [
                { id: "occupancy", label: "Doluluk" },
                { id: "movement", label: "Hareket (ABC)" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                role="radio"
                aria-checked={colorMode === id}
                onClick={() => setColorMode(id)}
                className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors ${
                  colorMode === id
                    ? "bg-accent/20 text-accent"
                    : "text-text-faint hover:text-text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {colorMode === "occupancy"
            ? OCCUPANCY_LEGEND.map(({ bucket, label }) => (
                <span key={bucket} className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <span
                    className="inline-block size-2.5 rounded-[3px]"
                    style={{ backgroundColor: OCCUPANCY_COLORS[bucket] }}
                  />
                  {label}
                </span>
              ))
            : ABC_LEGEND.map(({ bucket, label }) => (
                <span key={bucket} className="flex items-center gap-1.5 text-[11px] text-text-muted">
                  <span
                    className="inline-block size-2.5 rounded-[3px]"
                    style={{ backgroundColor: ABC_COLORS[bucket] }}
                  />
                  {label}
                </span>
              ))}
          <span className="h-3 w-px bg-ink-600" aria-hidden />
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted" title="Eşik altı stok taşıyan gözlerin üzerinde pin belirir">
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: "#e25c4a" }} />
            kritik stok pini
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: "#e0a93e" }} />
            uyarı pini
          </span>
        </div>
        <div className="mono absolute bottom-3 right-3 rounded bg-ink-900/80 px-2 py-1 text-[10.5px] text-text-faint">
          {model.bins.length} göz · sürükle: döndür · tekerlek: yakınlaş
        </div>
      </div>
    </div>
  );
}
