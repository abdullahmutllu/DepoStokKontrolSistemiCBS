import { useMemo, useState } from "react";
import { toast } from "sonner";
import { RotateCw, Trash2 } from "lucide-react";
import { useGenerateLayoutMutation, useLocationsQuery, useDeleteZoneMutation } from "@/api/endpoints/warehouses";
import type { RackPlacement, Warehouse } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { MonoCell } from "@/components/shared/table";
import { InfoHint } from "@/components/ui/InfoHint";
import { apiErrorMessage } from "@/lib/apiError";

const CELL = 0.5; // meters per grid cell — single source of truth for the editor

interface Template {
  w_cells: number;
  d_cells: number;
  shelf_count: number;
  bins_per_shelf: number;
  shelf_height: number;
  bin_capacity: number;
  color: string;
  rack_type: string;
  typeId: string;
}

/** Rack presets — a colour + sensible defaults per real warehouse rack family.
 * The first entry is the editor default (8×2, 3 kat, 4 göz). */
const RACK_TYPES = [
  { id: "palet", label: "Palet Rafı", color: "#5e8bff", w_cells: 8, d_cells: 2, shelf_count: 3, bins_per_shelf: 4, shelf_height: 1.5, bin_capacity: 100 },
  { id: "ambar", label: "Ambar Rafı", color: "#39b7a8", w_cells: 6, d_cells: 1, shelf_count: 5, bins_per_shelf: 5, shelf_height: 0.9, bin_capacity: 40 },
  { id: "konsol", label: "Konsol Rafı", color: "#a06cff", w_cells: 10, d_cells: 1, shelf_count: 4, bins_per_shelf: 2, shelf_height: 1.2, bin_capacity: 60 },
  { id: "soguk", label: "Soğuk Oda", color: "#46b6e8", w_cells: 6, d_cells: 2, shelf_count: 4, bins_per_shelf: 4, shelf_height: 1.4, bin_capacity: 80 },
  { id: "blok", label: "Blok İstif", color: "#e0a93e", w_cells: 4, d_cells: 4, shelf_count: 1, bins_per_shelf: 1, shelf_height: 2.0, bin_capacity: 500 },
] as const;

const DEFAULT_TEMPLATE: Template = {
  w_cells: RACK_TYPES[0].w_cells,
  d_cells: RACK_TYPES[0].d_cells,
  shelf_count: RACK_TYPES[0].shelf_count,
  bins_per_shelf: RACK_TYPES[0].bins_per_shelf,
  shelf_height: RACK_TYPES[0].shelf_height,
  bin_capacity: RACK_TYPES[0].bin_capacity,
  color: RACK_TYPES[0].color,
  rack_type: RACK_TYPES[0].label,
  typeId: RACK_TYPES[0].id,
};

function overlaps(a: RackPlacement, b: RackPlacement): boolean {
  return (
    a.col < b.col + b.w_cells &&
    b.col < a.col + a.w_cells &&
    a.row < b.row + b.d_cells &&
    b.row < a.row + a.d_cells
  );
}

/** Front-elevation thumbnail: shelf rows × bins per shelf, with real dims. */
function RackThumbnail({ template }: { template: Template }) {
  const wM = template.w_cells * CELL;
  const dM = template.d_cells * CELL;
  const hM = template.shelf_count * template.shelf_height;
  const gozCount = template.shelf_count * template.bins_per_shelf;
  const boxW = 200;
  const boxH = 96;
  const s = Math.min(boxW / Math.max(wM, 0.5), boxH / Math.max(hM, 0.5));
  const rw = wM * s;
  const rh = hM * s;
  const ox = (boxW - rw) / 2;
  const oy = boxH - rh;

  return (
    <div className="rounded-md border border-ink-600 bg-ink-950 p-2.5">
      <svg width="100%" viewBox={`0 0 ${boxW} ${boxH + 4}`} role="img" aria-label="Raf önizleme">
        {/* uprights + frame */}
        <rect x={ox} y={oy} width={rw} height={rh} fill={`${template.color}22`} stroke={template.color} strokeWidth={1.5} rx={1} />
        {/* shelf levels */}
        {Array.from({ length: template.shelf_count + 1 }).map((_, i) => {
          const y = oy + (rh / template.shelf_count) * i;
          return <line key={`s${i}`} x1={ox} y1={y} x2={ox + rw} y2={y} stroke={template.color} strokeWidth={1} opacity={0.75} />;
        })}
        {/* bin dividers */}
        {Array.from({ length: template.bins_per_shelf + 1 }).map((_, i) => {
          const x = ox + (rw / template.bins_per_shelf) * i;
          return <line key={`b${i}`} x1={x} y1={oy} x2={x} y2={oy + rh} stroke={template.color} strokeWidth={0.5} opacity={0.4} />;
        })}
      </svg>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[11px] text-text-muted">
        <span className="mono">
          {wM.toLocaleString("tr-TR")} × {dM.toLocaleString("tr-TR")} m taban
        </span>
        <span className="mono">yük. {hM.toLocaleString("tr-TR")} m</span>
        <span className="mono text-text-faint">{gozCount} göz</span>
      </div>
    </div>
  );
}

export function BuilderTab({ warehouse }: { warehouse: Warehouse }) {
  const [placed, setPlaced] = useState<RackPlacement[]>([]);
  const [template, setTemplate] = useState<Template>(DEFAULT_TEMPLATE);
  const [ghost, setGhost] = useState<{ col: number; row: number; valid: boolean } | null>(null);
  const [generate, generateState] = useGenerateLayoutMutation();
  const [deleteZone] = useDeleteZoneMutation();
  const existing = useLocationsQuery({ warehouseId: warehouse.id });

  const cols = Math.floor(warehouse.local_width / CELL);
  const rows = Math.floor(warehouse.local_depth / CELL);
  const scale = Math.min(720 / warehouse.local_width, 420 / warehouse.local_depth);

  const existingRacks = useMemo(
    () => (existing.data ?? []).filter((l) => l.type === "rack"),
    [existing.data],
  );
  const existingZones = useMemo(
    () => (existing.data ?? []).filter((l) => l.type === "zone"),
    [existing.data],
  );

  const previewCounts = useMemo(() => {
    const shelves = placed.reduce((acc, r) => acc + r.shelf_count, 0);
    const bins = placed.reduce((acc, r) => acc + r.shelf_count * r.bins_per_shelf, 0);
    const areaM2 = placed.reduce((acc, r) => acc + r.w_cells * r.d_cells * CELL * CELL, 0);
    return { racks: placed.length, shelves, bins, areaM2 };
  }, [placed]);

  // Bounds + collision checks shared by placement and the hover ghost.
  const fits = (col: number, row: number) =>
    col >= 0 &&
    row >= 0 &&
    col + template.w_cells <= cols &&
    row + template.d_cells <= rows;

  const hitsExistingRack = (col: number, row: number) =>
    existingRacks.some(
      (er) =>
        col * CELL < er.pos_x + er.dim_w &&
        er.pos_x < (col + template.w_cells) * CELL &&
        row * CELL < er.pos_y + er.dim_d &&
        er.pos_y < (row + template.d_cells) * CELL,
    );

  const collides = (col: number, row: number) => {
    const cand = { col, row, w_cells: template.w_cells, d_cells: template.d_cells } as RackPlacement;
    return placed.some((p) => overlaps(p, cand)) || hitsExistingRack(col, row);
  };

  const cellFromEvent = (evt: React.MouseEvent<SVGSVGElement>) => {
    const rect = evt.currentTarget.getBoundingClientRect();
    const xMeters = ((evt.clientX - rect.left) / rect.width) * warehouse.local_width;
    const yMeters = ((evt.clientY - rect.top) / rect.height) * warehouse.local_depth;
    return { col: Math.floor(xMeters / CELL), row: Math.floor(yMeters / CELL) };
  };

  const placeAt = (evt: React.MouseEvent<SVGSVGElement>) => {
    const { col, row } = cellFromEvent(evt);
    if (!fits(col, row)) {
      toast.error("Raf depo sınırlarının dışına taşıyor.");
      return;
    }
    const candidate: RackPlacement = {
      col,
      row,
      w_cells: template.w_cells,
      d_cells: template.d_cells,
      rotation: 0,
      shelf_count: template.shelf_count,
      bins_per_shelf: template.bins_per_shelf,
      shelf_height: template.shelf_height,
      bin_capacity: template.bin_capacity,
      color: template.color,
      rack_type: template.rack_type,
    };
    if (placed.some((p) => overlaps(p, candidate))) {
      toast.error("Raflar üst üste binemez.");
      return;
    }
    if (hitsExistingRack(col, row)) {
      toast.error("Bu alanda kayıtlı bir raf zaten var.");
      return;
    }
    setPlaced((prev) => [...prev, candidate]);
  };

  const hoverAt = (evt: React.MouseEvent<SVGSVGElement>) => {
    const { col, row } = cellFromEvent(evt);
    setGhost((g) =>
      g && g.col === col && g.row === row ? g : { col, row, valid: fits(col, row) && !collides(col, row) },
    );
  };

  const removeAt = (index: number) => setPlaced((prev) => prev.filter((_, i) => i !== index));

  const applyType = (t: (typeof RACK_TYPES)[number]) =>
    setTemplate({
      w_cells: t.w_cells,
      d_cells: t.d_cells,
      shelf_count: t.shelf_count,
      bins_per_shelf: t.bins_per_shelf,
      shelf_height: t.shelf_height,
      bin_capacity: t.bin_capacity,
      color: t.color,
      rack_type: t.label,
      typeId: t.id,
    });

  const rotate = () => setTemplate((t) => ({ ...t, w_cells: t.d_cells, d_cells: t.w_cells }));

  const submit = async () => {
    if (placed.length === 0) return;
    try {
      const result = await generate({
        warehouseId: warehouse.id,
        cell_size: CELL,
        racks: placed,
      }).unwrap();
      toast.success(
        `Yerleşim üretildi: ${result.created_racks} raf, ${result.created_bins} göz (${result.zone_code})`,
      );
      setPlaced([]);
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  // Major ruler ticks every 2 m (4 cells).
  const tick = 2; // meters
  const xTicks = Array.from({ length: Math.floor(warehouse.local_width / tick) + 1 }, (_, i) => i * tick);
  const yTicks = Array.from({ length: Math.floor(warehouse.local_depth / tick) + 1 }, (_, i) => i * tick);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
      <div>
        <p className="mb-2 text-[12.5px] text-text-muted">
          Bir raf tipi seç, ızgaraya tıklayarak yerleştir. İmleci gezdirince yerleşim önizlemesi
          çıkar; taslak rafa tıklayınca kaldırılır. Gri raflar kayıtlı yerleşimdir.
        </p>
        <div className="overflow-auto rounded-md border border-ink-600 bg-ink-950 p-3">
          <svg
            role="img"
            aria-label="Yerleşim ızgarası"
            data-testid="builder-grid"
            width={warehouse.local_width * scale}
            height={warehouse.local_depth * scale}
            viewBox={`0 0 ${warehouse.local_width} ${warehouse.local_depth}`}
            onClick={placeAt}
            onMouseMove={hoverAt}
            onMouseLeave={() => setGhost(null)}
            className="cursor-crosshair"
          >
            <rect width={warehouse.local_width} height={warehouse.local_depth} fill="#0f1522" />
            {/* grid */}
            {Array.from({ length: cols + 1 }).map((_, i) => (
              <line key={`v${i}`} x1={i * CELL} y1={0} x2={i * CELL} y2={warehouse.local_depth}
                stroke={i % 4 === 0 ? "#1d2740" : "#161e2f"} strokeWidth={0.02} />
            ))}
            {Array.from({ length: rows + 1 }).map((_, i) => (
              <line key={`h${i}`} x1={0} y1={i * CELL} x2={warehouse.local_width} y2={i * CELL}
                stroke={i % 4 === 0 ? "#1d2740" : "#161e2f"} strokeWidth={0.02} />
            ))}
            {/* ruler labels (meters) */}
            {xTicks.map((m) => (
              <text key={`xt${m}`} x={m + 0.08} y={0.5} fontSize={0.42} fill="#5c6682"
                fontFamily="IBM Plex Mono, monospace" pointerEvents="none">
                {m}
              </text>
            ))}
            {yTicks.filter((m) => m > 0).map((m) => (
              <text key={`yt${m}`} x={0.08} y={m - 0.12} fontSize={0.42} fill="#5c6682"
                fontFamily="IBM Plex Mono, monospace" pointerEvents="none">
                {m}
              </text>
            ))}
            {/* saved racks — coloured by stored rack type when available */}
            {existingRacks.map((er) => {
              const c = (er.meta?.color as string | undefined) ?? "#3d475c";
              return (
                <g key={er.id}>
                  <rect x={er.pos_x} y={er.pos_y} width={er.dim_w} height={er.dim_d}
                    fill={c} opacity={0.4} stroke={c} strokeWidth={0.04} />
                  <text x={er.pos_x + 0.15} y={er.pos_y + er.dim_d - 0.18}
                    fontSize={0.55} fill="#c3ccdf" fontFamily="IBM Plex Mono, monospace">
                    {er.code}
                  </text>
                </g>
              );
            })}
            {/* draft racks */}
            {placed.map((p, i) => {
              const fill = p.color ?? "#5e8bff";
              return (
                <g
                  key={i}
                  data-testid="draft-rack"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(i);
                  }}
                  className="cursor-pointer"
                >
                  <rect x={p.col * CELL} y={p.row * CELL} width={p.w_cells * CELL} height={p.d_cells * CELL}
                    fill={fill} opacity={0.8} stroke="#eaf1ff" strokeWidth={0.05} />
                  {/* bin division hints */}
                  {Array.from({ length: p.bins_per_shelf - 1 }).map((_, k) => {
                    const x = p.col * CELL + ((p.w_cells * CELL) / p.bins_per_shelf) * (k + 1);
                    return <line key={k} x1={x} y1={p.row * CELL} x2={x} y2={p.row * CELL + p.d_cells * CELL}
                      stroke="#0f1522" strokeWidth={0.02} opacity={0.5} />;
                  })}
                  <text x={p.col * CELL + 0.15} y={p.row * CELL + p.d_cells * CELL - 0.18}
                    fontSize={0.55} fill="#0f1522" fontFamily="IBM Plex Mono, monospace">
                    R{i + 1}
                  </text>
                </g>
              );
            })}
            {/* hover ghost — where the next rack lands (red if it can't) */}
            {ghost && (
              <rect
                x={ghost.col * CELL}
                y={ghost.row * CELL}
                width={template.w_cells * CELL}
                height={template.d_cells * CELL}
                fill={ghost.valid ? template.color : "#e25c4a"}
                opacity={0.32}
                stroke={ghost.valid ? template.color : "#e25c4a"}
                strokeWidth={0.07}
                strokeDasharray="0.25 0.18"
                pointerEvents="none"
              />
            )}
          </svg>
        </div>

        {existingZones.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-text-muted">Kayıtlı zonlar:</span>
            {existingZones.map((z) => (
              <span key={z.id} className="flex items-center gap-1 rounded border border-ink-600 bg-ink-800 px-2 py-0.5">
                <MonoCell>{z.code}</MonoCell>
                <button
                  aria-label={`${z.code} zonunu sil`}
                  className="text-text-faint hover:text-status-high"
                  onClick={async () => {
                    if (!window.confirm(`${z.code} zonu ve altındaki tüm raflar/gözler silinsin mi? Stok kayıtları da silinir.`)) return;
                    await deleteZone({ warehouseId: warehouse.id, zoneId: z.id });
                    toast.success(`${z.code} silindi`);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Template + generate */}
      <div className="space-y-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              Raf Tipi
              <InfoHint text="Hazır raf ailelerinden birini seç; boyut, kat, göz ve rengi otomatik gelir. Ölçüleri altından ince ayar yapabilirsin." />
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-2.5">
            <div className="flex flex-wrap gap-1.5">
              {RACK_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => applyType(t)}
                  aria-pressed={template.typeId === t.id}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11.5px] transition-colors ${
                    template.typeId === t.id
                      ? "border-accent bg-accent/15 text-text"
                      : "border-ink-600 bg-ink-800 text-text-muted hover:border-accent/50"
                  }`}
                >
                  <span className="inline-block size-2.5 rounded-[3px]" style={{ backgroundColor: t.color }} />
                  {t.label}
                </button>
              ))}
            </div>

            <RackThumbnail template={template} />

            {(
              [
                ["Genişlik (hücre)", "w_cells"],
                ["Derinlik (hücre)", "d_cells"],
                ["Kat sayısı", "shelf_count"],
                ["Kat başına göz", "bins_per_shelf"],
              ] as const
            ).map(([label, key]) => (
              <div key={key} className="flex items-center justify-between gap-2">
                <label htmlFor={`tpl-${key}`} className="text-[12px] text-text-muted">
                  {label}
                </label>
                <Input
                  id={`tpl-${key}`}
                  type="number"
                  min={1}
                  className="w-20 text-right"
                  value={template[key]}
                  onChange={(e) =>
                    setTemplate((t) => ({ ...t, [key]: Math.floor(num(e.target.value, t[key])) }))
                  }
                />
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="tpl-height" className="text-[12px] text-text-muted">
                Kat yüksekliği (m)
              </label>
              <Input
                id="tpl-height" type="number" min={0.5} step={0.1} className="w-20 text-right"
                value={template.shelf_height}
                onChange={(e) => setTemplate((t) => ({ ...t, shelf_height: num(e.target.value, t.shelf_height) }))}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="tpl-capacity" className="text-[12px] text-text-muted">
                Göz kapasitesi
              </label>
              <Input
                id="tpl-capacity" type="number" min={1} className="w-20 text-right"
                value={template.bin_capacity}
                onChange={(e) => setTemplate((t) => ({ ...t, bin_capacity: Math.floor(num(e.target.value, t.bin_capacity)) }))}
              />
            </div>
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <span className="text-[11px] text-text-faint">1 hücre = {CELL} m</span>
              <Button variant="secondary" size="sm" onClick={rotate}>
                <RotateCw size={12} /> 90° döndür
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Üretilecek</CardTitle>
          </CardHeader>
          <CardBody className="space-y-1.5">
            <div className="flex justify-between text-[13px]">
              <span className="text-text-muted">Raf</span>
              <MonoCell data-testid="preview-racks">{previewCounts.racks}</MonoCell>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-text-muted">Kat</span>
              <MonoCell>{previewCounts.shelves}</MonoCell>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-text-muted">Göz</span>
              <MonoCell data-testid="preview-bins">{previewCounts.bins}</MonoCell>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-text-muted">Taban alanı</span>
              <MonoCell>{previewCounts.areaM2.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} m²</MonoCell>
            </div>
            <div className="pt-2">
              <Button
                className="w-full"
                disabled={placed.length === 0 || generateState.isLoading}
                onClick={() => void submit()}
              >
                {generateState.isLoading ? "Üretiliyor…" : "Yerleşimi üret"}
              </Button>
              {placed.length > 0 && (
                <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setPlaced([])}>
                  Taslağı temizle
                </Button>
              )}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
