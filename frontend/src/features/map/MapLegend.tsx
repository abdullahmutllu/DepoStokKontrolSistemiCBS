import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useAppSelector } from "@/app/hooks";

/** Contextual map legend: explains exactly the symbols that are currently
 * visible — base warehouse markers always, network layers only when toggled. */

function Row({ swatch, label }: { swatch: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] leading-tight text-text-muted">
      <span className="flex w-7 shrink-0 items-center justify-center">{swatch}</span>
      {label}
    </div>
  );
}

const line = (color: string, dashed = false, width = 2) => (
  <span
    className="inline-block w-6"
    style={{
      borderTop: `${width}px ${dashed ? "dashed" : "solid"} ${color}`,
    }}
  />
);

const dot = (color: string, size = 10, ring = false) => (
  <span
    className="inline-block rounded-full"
    style={{
      width: size,
      height: size,
      backgroundColor: ring ? "transparent" : color,
      border: ring ? `2px dashed ${color}` : `1px solid #0f1522`,
    }}
  />
);

export function MapLegend() {
  const toggles = useAppSelector((s) => s.mapWorkspace.networkLayers);
  const cogResult = useAppSelector((s) => s.mapWorkspace.cogResult);
  const panelTab = useAppSelector((s) => s.mapWorkspace.panelTab);
  const [open, setOpen] = useState(true);

  const networkActive = panelTab === "network";

  return (
    <div className="absolute bottom-8 left-3 z-10 w-56 rounded-md border border-ink-600 bg-ink-900/92 backdrop-blur">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-text-faint hover:text-text-muted"
        aria-expanded={open}
      >
        Lejant
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-ink-600 px-2.5 py-2">
          <Row
            swatch={
              <span className="flex gap-0.5">
                {["#3fb970", "#e0a93e", "#e25c4a"].map((c) => (
                  <span
                    key={c}
                    className="inline-block size-2.5 rounded-[3px] border-2"
                    style={{ borderColor: c, backgroundColor: "#131a2a" }}
                  />
                ))}
              </span>
            }
            label="Depo — renk: doluluk, boyut: stok miktarı"
          />
          {networkActive && toggles.customers && (
            <Row swatch={dot("#9dc1ff")} label="Müşteri noktası — boyut: talep ağırlığı" />
          )}
          {networkActive && toggles.heatmap && (
            <Row
              swatch={
                <span
                  className="inline-block size-3.5 rounded-full"
                  style={{
                    background: "radial-gradient(circle, #6a5cff 0%, #4b7bd4aa 55%, transparent 75%)",
                  }}
                />
              }
              label="Talep yoğunluğu (ısı haritası)"
            />
          )}
          {networkActive && toggles.assignments && (
            <Row swatch={line("#5e8bff")} label="Müşteri → en yakın depo ataması" />
          )}
          {networkActive && toggles.voronoi && (
            <Row swatch={line("#8a94ad")} label="Hizmet bölgesi sınırı (Voronoi)" />
          )}
          {networkActive && toggles.coverage && (
            <Row swatch={dot("#5e8bff", 12, true)} label="Kapsama halkası — 10/25/50 km" />
          )}
          {networkActive && toggles.flow && (
            <Row swatch={line("#e0a93e", false, 3)} label="Depolar arası akış — kalınlık: hacim" />
          )}
          {networkActive && cogResult && (
            <>
              <Row swatch={dot("#e0a93e", 11)} label="Önerilen yeni depo (ağırlık merkezi)" />
              <Row swatch={line("#e0a93e", true)} label="Müşteri → önerilen depo" />
            </>
          )}
          {!networkActive && (
            <Row
              swatch={
                <span
                  className="inline-block h-3 w-5 rounded-sm border border-dashed"
                  style={{ borderColor: "#5e8bff", backgroundColor: "#5e8bff22" }}
                />
              }
              label="Çizilen / kayıtlı analiz bölgesi"
            />
          )}
        </div>
      )}
    </div>
  );
}
