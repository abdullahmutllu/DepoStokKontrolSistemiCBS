import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useWarehousesQuery } from "@/api/endpoints/warehouses";
import {
  useLowStockQuery,
  useMovementHistoryQuery,
  useOccupancyQuery,
  useStockByLocationQuery,
  useTopMoversQuery,
} from "@/api/endpoints/reports";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/shared/states";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, THead, Th, Tr, Td, MonoCell } from "@/components/shared/table";
import { Select } from "@/components/ui/input";
import { OCCUPANCY_COLORS, OCCUPANCY_LEGEND, occupancyBucket } from "@/features/three/occupancy";
import { apiErrorMessage } from "@/lib/apiError";
import { formatDay } from "@/lib/utils";

/** Validated categorical palette (dataviz six-checks, dark surface):
 * flow semantics — in=green, out=red, move=accent blue, correction=ochre. */
const FLOW_COLORS = {
  receive: "#35a765",
  pick: "#e25c4a",
  transfer: "#5e8bff",
  adjust: "#bc8b25",
} as const;

const CHART_TEXT = { fontSize: 11, fill: "#8a94ad" };
const TOOLTIP_STYLE = {
  backgroundColor: "#1d2740",
  border: "1px solid #2a3550",
  borderRadius: 6,
  fontSize: 12,
  color: "#e6eaf4",
};

export function ReportsPage() {
  const warehouses = useWarehousesQuery();
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [groupType, setGroupType] = useState<"zone" | "aisle" | "rack">("zone");

  const activeWarehouse = warehouseId ?? warehouses.data?.[0]?.id ?? null;

  const history = useMovementHistoryQuery({ days: 14 });
  const byLocation = useStockByLocationQuery(
    { warehouse_id: activeWarehouse ?? 0, group_type: groupType },
    { skip: activeWarehouse == null },
  );
  const occupancy = useOccupancyQuery(
    { warehouse_id: activeWarehouse ?? 0 },
    { skip: activeWarehouse == null },
  );
  const topMovers = useTopMoversQuery({ days: 30, limit: 8 });
  const lowStock = useLowStockQuery();

  const historyData = useMemo(
    () =>
      (history.data ?? []).map((p) => ({
        day: formatDay(p.day),
        "Mal kabul": p.receive,
        Toplama: p.pick,
        Transfer: p.transfer,
        Düzeltme: p.adjust,
      })),
    [history.data],
  );

  const occupancyBuckets = useMemo(() => {
    const counts = { empty: 0, low: 0, mid: 0, high: 0 };
    for (const row of occupancy.data ?? []) {
      counts[occupancyBucket(row.quantity, row.capacity)] += 1;
    }
    return OCCUPANCY_LEGEND.map(({ bucket, label }) => ({
      label,
      bucket,
      adet: counts[bucket],
    }));
  }, [occupancy.data]);

  return (
    <div>
      <PageHeader
        title="Raporlar"
        description="Hareket, doluluk ve düşük stok görünümleri."
        actions={
          <>
            <Select
              value={activeWarehouse ?? ""}
              onChange={(e) => setWarehouseId(Number(e.target.value))}
              className="w-52"
              aria-label="Depo seç"
            >
              {(warehouses.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
            <Select
              value={groupType}
              onChange={(e) => setGroupType(e.target.value as typeof groupType)}
              className="w-32"
              aria-label="Gruplama"
            >
              <option value="zone">Zon bazında</option>
              <option value="aisle">Koridor bazında</option>
              <option value="rack">Raf bazında</option>
            </Select>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* Movement history */}
        <Card>
          <CardHeader>
            <CardTitle>Hareket Geçmişi · 14 gün</CardTitle>
          </CardHeader>
          <CardBody>
            {history.isLoading ? (
              <LoadingRows rows={4} />
            ) : historyData.length === 0 ? (
              <EmptyState title="Hareket verisi yok" hint="Stok işlemleri yapıldıkça günlük akış burada çizilir." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={historyData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="#1d2740" vertical={false} />
                  <XAxis dataKey="day" tick={CHART_TEXT} axisLine={{ stroke: "#2a3550" }} tickLine={false} />
                  <YAxis tick={CHART_TEXT} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ stroke: "#3d475c" }} />
                  <Legend wrapperStyle={{ fontSize: 11.5 }} iconType="plainline" />
                  <Line type="monotone" dataKey="Mal kabul" stroke={FLOW_COLORS.receive} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Toplama" stroke={FLOW_COLORS.pick} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Transfer" stroke={FLOW_COLORS.transfer} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Düzeltme" stroke={FLOW_COLORS.adjust} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        {/* Stock by zone/aisle/rack */}
        <Card>
          <CardHeader>
            <CardTitle>
              Stok Dağılımı · {groupType === "zone" ? "zon" : groupType === "aisle" ? "koridor" : "raf"}
            </CardTitle>
          </CardHeader>
          <CardBody>
            {byLocation.isLoading ? (
              <LoadingRows rows={4} />
            ) : byLocation.isError ? (
              <ErrorState message={apiErrorMessage(byLocation.error)} onRetry={byLocation.refetch} />
            ) : !byLocation.data || byLocation.data.length === 0 ? (
              <EmptyState title="Yerleşim yok" hint="Bu depoda önce yerleşim oluşturun." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={byLocation.data.slice(0, 12)}
                  layout="vertical"
                  margin={{ top: 4, right: 24, bottom: 0, left: 8 }}
                  barSize={14}
                >
                  <CartesianGrid stroke="#1d2740" horizontal={false} />
                  <XAxis type="number" tick={CHART_TEXT} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="code"
                    width={72}
                    tick={{ ...CHART_TEXT, fontFamily: "IBM Plex Mono, monospace" }}
                    axisLine={{ stroke: "#2a3550" }}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#1d274066" }} />
                  <Bar dataKey="total_quantity" name="Toplam adet" fill="#5e8bff" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        {/* Occupancy distribution — status colors are earned here */}
        <Card>
          <CardHeader>
            <CardTitle>Göz Doluluk Dağılımı</CardTitle>
          </CardHeader>
          <CardBody>
            {occupancy.isLoading ? (
              <LoadingRows rows={4} />
            ) : !occupancy.data || occupancy.data.length === 0 ? (
              <EmptyState title="Kapasiteli göz yok" hint="Yerleşim üretince gözler kapasiteleriyle burada sayılır." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={occupancyBuckets} margin={{ top: 8, right: 8, bottom: 0, left: -18 }} barSize={40}>
                  <CartesianGrid stroke="#1d2740" vertical={false} />
                  <XAxis dataKey="label" tick={CHART_TEXT} axisLine={{ stroke: "#2a3550" }} tickLine={false} />
                  <YAxis tick={CHART_TEXT} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#1d274066" }} />
                  <Bar dataKey="adet" name="Göz sayısı" radius={[4, 4, 0, 0]}>
                    {occupancyBuckets.map((entry) => (
                      <Cell key={entry.bucket} fill={OCCUPANCY_COLORS[entry.bucket]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>

        {/* Top movers */}
        <Card>
          <CardHeader>
            <CardTitle>En Hareketli Ürünler · 30 gün</CardTitle>
          </CardHeader>
          <CardBody>
            {topMovers.isLoading ? (
              <LoadingRows rows={4} />
            ) : !topMovers.data || topMovers.data.length === 0 ? (
              <EmptyState title="Hareket verisi yok" hint="İşlem yapıldıkça en çok dokunulan ürünler burada sıralanır." />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={topMovers.data}
                  layout="vertical"
                  margin={{ top: 4, right: 24, bottom: 0, left: 8 }}
                  barSize={14}
                >
                  <CartesianGrid stroke="#1d2740" horizontal={false} />
                  <XAxis type="number" tick={CHART_TEXT} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="sku"
                    width={92}
                    tick={{ ...CHART_TEXT, fontFamily: "IBM Plex Mono, monospace" }}
                    axisLine={{ stroke: "#2a3550" }}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#1d274066" }} />
                  <Bar dataKey="movement_count" name="Hareket sayısı" fill="#5e8bff" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Low stock table */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Düşük Stok Raporu</CardTitle>
        </CardHeader>
        <CardBody>
          {lowStock.isLoading ? (
            <LoadingRows rows={3} />
          ) : !lowStock.data || lowStock.data.length === 0 ? (
            <p className="py-3 text-center text-[12.5px] text-text-muted">
              Eşik altına düşen ürün yok.
            </p>
          ) : (
            <DataTable>
              <THead>
                <Th>SKU</Th>
                <Th>Ürün</Th>
                <Th>Birim</Th>
                <Th className="text-right">Toplam stok</Th>
                <Th className="text-right">Eşik</Th>
                <Th className="text-right">Açık</Th>
              </THead>
              <tbody>
                {lowStock.data.map((r) => (
                  <Tr key={r.product_id}>
                    <Td><MonoCell>{r.sku}</MonoCell></Td>
                    <Td>{r.name}</Td>
                    <Td className="text-text-muted">{r.unit}</Td>
                    <Td className="text-right"><MonoCell>{r.total_quantity}</MonoCell></Td>
                    <Td className="text-right"><MonoCell>{r.min_stock_threshold}</MonoCell></Td>
                    <Td className="text-right">
                      <MonoCell className="text-status-high">
                        −{r.min_stock_threshold - r.total_quantity}
                      </MonoCell>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
