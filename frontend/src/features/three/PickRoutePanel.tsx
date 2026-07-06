import { useState } from "react";
import { toast } from "sonner";
import { Route, Shuffle, X } from "lucide-react";
import { usePickRouteMutation } from "@/api/endpoints/network";
import type { PickRoute, PolicyRoute } from "@/types";
import type { SceneModel } from "@/features/three/sceneModel";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/InfoHint";
import { apiErrorMessage } from "@/lib/apiError";

const POLICY_LABELS: Record<PolicyRoute["policy"], string> = {
  s_shape: "S-shape",
  largest_gap: "Largest-gap",
  optimized: "Optimize",
};

/** Toplama rotası planlayıcı: göz seçimi → 3 politika karşılaştırması →
 * seçilen rota 3B zeminde animasyonlu çizilir. */
export function PickRoutePanel({
  warehouseId,
  model,
  highlightedIds,
  result,
  onResult,
  policy,
  onPolicyChange,
}: {
  warehouseId: number;
  model: SceneModel;
  highlightedIds: number[];
  result: PickRoute | null;
  onResult: (r: PickRoute | null) => void;
  policy: PolicyRoute["policy"];
  onPolicyChange: (p: PolicyRoute["policy"]) => void;
}) {
  const [run, runState] = usePickRouteMutation();
  const [lastCount, setLastCount] = useState(0);

  const compute = async (locationIds: number[]) => {
    if (locationIds.length < 2) {
      toast.error("Rota için en az 2 dolu göz gerekli.");
      return;
    }
    try {
      const r = await run({ warehouseId, location_ids: locationIds }).unwrap();
      setLastCount(locationIds.length);
      onResult(r);
      onPolicyChange(r.best_policy as PolicyRoute["policy"]);
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  const randomPicks = () => {
    const stocked = model.bins.filter((b) => b.quantity > 0).map((b) => b.id);
    const shuffled = [...stocked].sort(() => Math.random() - 0.5);
    void compute(shuffled.slice(0, Math.min(8, shuffled.length)));
  };

  const sShape = result?.routes.find((r) => r.policy === "s_shape");

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-ink-600 bg-ink-850 px-3 py-2">
      <span className="flex items-center gap-1.5 text-[12px] font-medium uppercase tracking-wide text-text-muted">
        <Route size={13} /> Toplama rotası
        <InfoHint text="Toplanacak gözleri seç; üç yöntem yürüme mesafesini karşılaştırır ve en kısası 3B zeminde çizilir. Depoda gereksiz adım atmazsın." />
      </span>

      {!result ? (
        <>
          <Button variant="secondary" size="sm" onClick={randomPicks} disabled={runState.isLoading}>
            <Shuffle size={12} /> Rastgele 8 göz
          </Button>
          {highlightedIds.length >= 2 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void compute(highlightedIds)}
              disabled={runState.isLoading}
            >
              Vurgulanan {highlightedIds.length} gözü rotala
            </Button>
          )}
          <span className="text-[11.5px] text-text-faint">
            {runState.isLoading
              ? "Rota hesaplanıyor…"
              : "S-shape · Largest-gap · Optimize karşılaştırması"}
          </span>
        </>
      ) : (
        <>
          {result.routes.map((r) => {
            const isBest = r.policy === result.best_policy;
            const isActive = r.policy === policy;
            const delta =
              sShape && sShape.total_m > 0 && r.policy !== "s_shape"
                ? Math.round(((sShape.total_m - r.total_m) / sShape.total_m) * 100)
                : null;
            return (
              <button
                key={r.policy}
                onClick={() => onPolicyChange(r.policy)}
                aria-pressed={isActive}
                className={`mono rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                  isActive
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-ink-600 bg-ink-800 text-text-muted hover:border-accent/50"
                }`}
              >
                {POLICY_LABELS[r.policy]} · {r.total_m.toLocaleString("tr-TR")} m
                {delta !== null && delta > 0 && (
                  <span className="ml-1 text-status-low">−%{delta}</span>
                )}
                {isBest && <span className="ml-1">★</span>}
              </button>
            );
          })}
          <span className="text-[11px] text-text-faint">
            {lastCount} göz · optimum referansı: Ratliff–Rosenthal (1983)
          </span>
          <Button variant="ghost" size="sm" onClick={() => onResult(null)}>
            <X size={12} /> Kapat
          </Button>
        </>
      )}
    </div>
  );
}
