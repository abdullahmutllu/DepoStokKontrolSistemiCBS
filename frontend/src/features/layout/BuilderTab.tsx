import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { useGenerateLayoutMutation, useLocationsQuery, useDeleteZoneMutation } from "@/api/endpoints/warehouses";
import type { RackPlacement, Warehouse } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { MonoCell } from "@/components/shared/table";
import { apiErrorMessage } from "@/lib/apiError";

const CELL = 0.5; // meters per grid cell — single source of truth for the editor

interface Template {
  w_cells: number;
  d_cells: number;
  shelf_count: number;
  bins_per_shelf: number;
  shelf_height: number;
  bin_capacity: number;
}

function overlaps(a: RackPlacement, b: RackPlacement): boolean {
  return (
    a.col < b.col + b.w_cells &&
    b.col < a.col + a.w_cells &&
    a.row < b.row + b.d_cells &&
    b.row < a.row + a.d_cells
  );
}

export function BuilderTab({ warehouse }: { warehouse: Warehouse }) {
  const [placed, setPlaced] = useState<RackPlacement[]>([]);
  const [template, setTemplate] = useState<Template>({
    w_cells: 8,
    d_cells: 2,
    shelf_count: 3,
    bins_per_shelf: 4,
    shelf_height: 1.5,
    bin_capacity: 100,
  });
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
    return { racks: placed.length, shelves, bins };
  }, [placed]);

  const placeAt = (evt: React.MouseEvent<SVGSVGElement>) => {
    const svg = evt.currentTarget;
    const rect = svg.getBoundingClientRect();
    const xMeters = ((evt.clientX - rect.left) / rect.width) * warehouse.local_width;
    const yMeters = ((evt.clientY - rect.top) / rect.height) * warehouse.local_depth;
    const col = Math.floor(xMeters / CELL);
    const row = Math.floor(yMeters / CELL);

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
    };

    if (col < 0 || row < 0 || col + candidate.w_cells > cols || row + candidate.d_cells > rows) {
      toast.error("Raf depo sınırlarının dışına taşıyor.");
      return;
    }
    if (placed.some((p) => overlaps(p, candidate))) {
      toast.error("Raflar üst üste binemez.");
      return;
    }
    const hitsExisting = existingRacks.some(
      (er) =>
        col * CELL < er.pos_x + er.dim_w &&
        er.pos_x < (col + candidate.w_cells) * CELL &&
        row * CELL < er.pos_y + er.dim_d &&
        er.pos_y < (row + candidate.d_cells) * CELL,
    );
    if (hitsExisting) {
      toast.error("Bu alanda kayıtlı bir raf zaten var.");
      return;
    }
    setPlaced((prev) => [...prev, candidate]);
  };

  const removeAt = (index: number) => setPlaced((prev) => prev.filter((_, i) => i !== index));

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

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
      <div>
        <p className="mb-2 text-[12.5px] text-text-muted">
          Izgaraya tıklayarak raf yerleştirin; taslak rafa tıklayınca kaldırılır. Gri raflar
          kayıtlı yerleşimdir.
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
            {/* saved racks */}
            {existingRacks.map((er) => (
              <g key={er.id}>
                <rect x={er.pos_x} y={er.pos_y} width={er.dim_w} height={er.dim_d}
                  fill="#3d475c" opacity={0.55} stroke="#5c6682" strokeWidth={0.04} />
                <text x={er.pos_x + 0.15} y={er.pos_y + er.dim_d - 0.18}
                  fontSize={0.55} fill="#8a94ad" fontFamily="IBM Plex Mono, monospace">
                  {er.code}
                </text>
              </g>
            ))}
            {/* draft racks */}
            {placed.map((p, i) => (
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
                  fill="#5e8bff" opacity={0.75} stroke="#9dc1ff" strokeWidth={0.05} />
                <text x={p.col * CELL + 0.15} y={p.row * CELL + p.d_cells * CELL - 0.18}
                  fontSize={0.55} fill="#0f1522" fontFamily="IBM Plex Mono, monospace">
                  R{i + 1}
                </text>
              </g>
            ))}
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
            <CardTitle>Raf Şablonu</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2.5">
            {(
              [
                ["Genişlik (hücre)", "w_cells", 1],
                ["Derinlik (hücre)", "d_cells", 1],
                ["Kat sayısı", "shelf_count", 1],
                ["Kat başına göz", "bins_per_shelf", 1],
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
            <p className="text-[11px] text-text-faint">1 hücre = {CELL} m</p>
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
