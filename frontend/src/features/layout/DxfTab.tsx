import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileUp, Upload } from "lucide-react";
import { useParseDxfMutation, useGenerateFromDxfMutation } from "@/api/endpoints/ai";
import type { DxfPreview, Warehouse } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { MonoCell } from "@/components/shared/table";
import { apiErrorMessage } from "@/lib/apiError";

export function DxfTab({ warehouse }: { warehouse: Warehouse }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<DxfPreview | null>(null);
  const [params, setParams] = useState({ shelf_count: 3, bins_per_shelf: 4, shelf_height: 1.5, bin_capacity: 100 });
  const [parseDxf, parseState] = useParseDxfMutation();
  const [generateFromDxf, generateState] = useGenerateFromDxfMutation();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const result = await parseDxf({ warehouseId: warehouse.id, file }).unwrap();
      setPreview(result);
      result.warnings.forEach((w) => toast.warning(w));
    } catch (err) {
      setPreview(null);
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  const generate = async () => {
    if (!preview) return;
    try {
      const result = await generateFromDxf({
        warehouseId: warehouse.id,
        preview,
        ...params,
        bin_capacity: params.bin_capacity,
      }).unwrap();
      toast.success(`DXF'ten yerleşim üretildi: ${result.created_racks} raf, ${result.created_bins} göz`);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      toast.error(apiErrorMessage(err as Parameters<typeof apiErrorMessage>[0]));
    }
  };

  const scale = preview ? Math.min(680 / Math.max(preview.bounds_w, 1), 380 / Math.max(preview.bounds_d, 1)) : 1;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>DXF Planı Yükle</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          <p className="text-[12.5px] text-text-muted">
            Katman adları <MonoCell>RACK</MonoCell>, <MonoCell>AISLE</MonoCell>,{" "}
            <MonoCell>ZONE</MonoCell>, <MonoCell>WALL</MonoCell> olmalı. Raflar kapalı
            dikdörtgen çizilmeli. DWG desteklenmez — önce DXF'e çevirin (ör. ODA File
            Converter).
          </p>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".dxf"
              className="hidden"
              id="dxf-file"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={parseState.isLoading}>
              <FileUp size={14} /> {parseState.isLoading ? "Okunuyor…" : "DXF seç"}
            </Button>
            {preview && (
              <span className="text-[12px] text-text-muted">
                Birim: <MonoCell>{preview.units}</MonoCell> · {preview.racks.length} raf bulundu
              </span>
            )}
          </div>
        </CardBody>
      </Card>

      {preview && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_260px]">
          <div className="overflow-auto rounded-md border border-ink-600 bg-ink-950 p-3">
            <svg
              role="img"
              aria-label="DXF önizleme"
              width={preview.bounds_w * scale}
              height={preview.bounds_d * scale}
              viewBox={`0 0 ${preview.bounds_w} ${preview.bounds_d}`}
            >
              <rect width={preview.bounds_w} height={preview.bounds_d} fill="#0f1522" />
              {preview.zones.map((z, i) => (
                <rect key={`z${i}`} x={z.x} y={z.y} width={z.w} height={z.d}
                  fill="#5e8bff" opacity={0.06} stroke="#2a3550" strokeWidth={0.05} strokeDasharray="0.3 0.2" />
              ))}
              {preview.aisles.map((a, i) => (
                <rect key={`a${i}`} x={a.x} y={a.y} width={a.w} height={a.d}
                  fill="#3d475c" opacity={0.2} />
              ))}
              {preview.walls.map((w, i) => (
                <line key={`w${i}`} x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
                  stroke="#5c6682" strokeWidth={0.12} />
              ))}
              {preview.racks.map((r, i) => (
                <rect key={`r${i}`} x={r.x} y={r.y} width={r.w} height={r.d}
                  fill="#5e8bff" opacity={0.7} stroke="#9dc1ff" strokeWidth={0.06} />
              ))}
            </svg>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Raf Parametreleri</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2.5">
              {(
                [
                  ["Kat sayısı", "shelf_count", 1],
                  ["Kat başına göz", "bins_per_shelf", 1],
                ] as const
              ).map(([label, key]) => (
                <div key={key} className="flex items-center justify-between gap-2">
                  <label htmlFor={`dxf-${key}`} className="text-[12px] text-text-muted">{label}</label>
                  <Input
                    id={`dxf-${key}`} type="number" min={1} className="w-20 text-right"
                    value={params[key]}
                    onChange={(e) => setParams((p) => ({ ...p, [key]: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))}
                  />
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="dxf-height" className="text-[12px] text-text-muted">Kat yüksekliği (m)</label>
                <Input
                  id="dxf-height" type="number" min={0.5} step={0.1} className="w-20 text-right"
                  value={params.shelf_height}
                  onChange={(e) => setParams((p) => ({ ...p, shelf_height: Number(e.target.value) || p.shelf_height }))}
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="dxf-capacity" className="text-[12px] text-text-muted">Göz kapasitesi</label>
                <Input
                  id="dxf-capacity" type="number" min={1} className="w-20 text-right"
                  value={params.bin_capacity}
                  onChange={(e) => setParams((p) => ({ ...p, bin_capacity: Math.max(1, Math.floor(Number(e.target.value) || 1)) }))}
                />
              </div>
              <div className="pt-1 text-[12.5px] text-text-muted">
                Üretilecek göz:{" "}
                <MonoCell>
                  {preview.racks.length * params.shelf_count * params.bins_per_shelf}
                </MonoCell>
              </div>
              <Button className="w-full" onClick={() => void generate()} disabled={generateState.isLoading}>
                <Upload size={14} /> {generateState.isLoading ? "Üretiliyor…" : "Onayla ve üret"}
              </Button>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
