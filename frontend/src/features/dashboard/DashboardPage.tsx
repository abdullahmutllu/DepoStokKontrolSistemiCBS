import { Link } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { useWarehouseSummariesQuery, useLowStockQuery } from "@/api/endpoints/reports";
import { useKpiQuery } from "@/api/endpoints/logistics";
import { useAiSummaryQuery } from "@/api/endpoints/ai";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/shared/states";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, THead, Th, Tr, Td, MonoCell } from "@/components/shared/table";
import { OccupancyBadge } from "@/components/ui/badge";
import { occupancyBucket } from "@/features/three/occupancy";
import { apiErrorMessage } from "@/lib/apiError";
import { Button } from "@/components/ui/button";

const KPI_TILES = [
  { key: "inventory_turnover_30d", label: "Devir hızı · 30g", format: (v: number) => v.toFixed(2) },
  { key: "outbound_units_30d", label: "Çıkış · 30g", format: (v: number) => v.toLocaleString("tr-TR") },
  { key: "inbound_units_30d", label: "Giriş · 30g", format: (v: number) => v.toLocaleString("tr-TR") },
  { key: "movements_per_day_7d", label: "Hareket/gün · 7g", format: (v: number) => v.toFixed(1) },
  { key: "open_orders", label: "Açık sipariş", format: (v: number) => String(v) },
  { key: "active_shipments", label: "Aktif sevkiyat", format: (v: number) => String(v) },
] as const;

export function DashboardPage() {
  const summaries = useWarehouseSummariesQuery();
  const lowStock = useLowStockQuery();
  const aiSummary = useAiSummaryQuery();
  const kpi = useKpiQuery();

  return (
    <div>
      <PageHeader
        title="Genel Bakış"
        description="Tüm depolarınızın doluluk ve stok durumu tek bakışta."
      />

      {/* KPI şeridi: operasyonun nabzı */}
      {kpi.data && (
        <div
          className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6"
          data-testid="kpi-strip"
        >
          {KPI_TILES.map(({ key, label, format }) => (
            <div key={key} className="rounded-md border border-ink-600 bg-ink-850 px-3 py-2">
              <div className="mono text-[16px] font-medium">{format(kpi.data![key])}</div>
              <div className="text-[10.5px] uppercase tracking-wide text-text-faint">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Warehouse tiles */}
      {summaries.isLoading ? (
        <LoadingRows rows={2} />
      ) : summaries.isError ? (
        <ErrorState message={apiErrorMessage(summaries.error)} onRetry={summaries.refetch} />
      ) : !summaries.data || summaries.data.length === 0 ? (
        <EmptyState
          title="Henüz depo yok"
          hint="İlk deponuzu ekleyin; haritada konumunu seçip yerleşimini kurun."
          action={
            <Button asChild>
              <Link to="/warehouses">Depo ekle</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {summaries.data.map((s) => (
            <Link key={s.warehouse_id} to={`/warehouses/${s.warehouse_id}`}>
              <Card className="transition-colors hover:border-accent/60">
                <CardBody className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold">{s.warehouse_name}</span>
                    <OccupancyBadge
                      bucket={
                        s.bin_count === 0
                          ? "empty"
                          : occupancyBucket(Math.round(s.occupancy_percent), 100)
                      }
                      percent={s.occupancy_percent}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: "Göz", value: s.bin_count },
                      { label: "Dolu göz", value: s.used_bin_count },
                      { label: "Toplam adet", value: s.total_quantity },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded bg-ink-900 px-2 py-1.5">
                        <div className="mono text-[15px] font-medium">{value}</div>
                        <div className="text-[10.5px] uppercase tracking-wide text-text-faint">
                          {label}
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* occupancy bar — data, not decoration */}
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink-600">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, s.occupancy_percent)}%`,
                        backgroundColor:
                          s.occupancy_percent > 85
                            ? "#e25c4a"
                            : s.occupancy_percent >= 60
                              ? "#e0a93e"
                              : "#3fb970",
                      }}
                    />
                  </div>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Low stock */}
        <Card>
          <CardHeader>
            <CardTitle>Düşük Stok</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/reports">
                Rapora git <ArrowRight size={13} />
              </Link>
            </Button>
          </CardHeader>
          <CardBody>
            {lowStock.isLoading ? (
              <LoadingRows rows={3} />
            ) : lowStock.isError ? (
              <ErrorState message={apiErrorMessage(lowStock.error)} onRetry={lowStock.refetch} />
            ) : !lowStock.data || lowStock.data.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-text-muted">
                Eşik altına düşen ürün yok.
              </p>
            ) : (
              <DataTable>
                <THead>
                  <Th>SKU</Th>
                  <Th>Ürün</Th>
                  <Th className="text-right">Stok / Eşik</Th>
                </THead>
                <tbody>
                  {lowStock.data.slice(0, 6).map((r) => (
                    <Tr key={r.product_id}>
                      <Td>
                        <MonoCell>{r.sku}</MonoCell>
                      </Td>
                      <Td>{r.name}</Td>
                      <Td className="text-right">
                        <MonoCell className="text-status-high">
                          {r.total_quantity}/{r.min_stock_threshold}
                        </MonoCell>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </DataTable>
            )}
          </CardBody>
        </Card>

        {/* AI weekly summary */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5">
              <Sparkles size={13} /> Haftalık Özet
            </CardTitle>
          </CardHeader>
          <CardBody>
            {aiSummary.isLoading ? (
              <LoadingRows rows={3} />
            ) : aiSummary.isError ? (
              <p className="text-[12.5px] text-text-muted">
                Özet şu anda hazırlanamadı. Veriler raporlar sayfasında her zaman güncel.
              </p>
            ) : (
              <div className="space-y-2.5">
                <p className="whitespace-pre-line text-[13px] leading-relaxed text-text">
                  {aiSummary.data?.summary}
                </p>
                {aiSummary.data && aiSummary.data.anomalies.length > 0 && (
                  <ul className="space-y-1">
                    {aiSummary.data.anomalies.map((a, i) => (
                      <li key={i} className="flex gap-1.5 text-[12.5px] text-status-mid">
                        <span aria-hidden>▲</span> {a}
                      </li>
                    ))}
                  </ul>
                )}
                {aiSummary.data && !aiSummary.data.ai_available && (
                  <p className="text-[11px] text-text-faint">
                    AI kapalı — ham veriler gösteriliyor. OPENROUTER_API_KEY tanımlayınca düz yazı
                    özet gelir.
                  </p>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
