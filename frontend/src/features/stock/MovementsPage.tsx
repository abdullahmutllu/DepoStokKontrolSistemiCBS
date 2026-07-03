import { useState } from "react";
import { useMovementsQuery } from "@/api/endpoints/stock";
import { useWarehousesQuery } from "@/api/endpoints/warehouses";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/shared/states";
import { DataTable, THead, Th, Tr, Td, MonoCell, Pagination } from "@/components/shared/table";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/input";
import { apiErrorMessage } from "@/lib/apiError";
import { formatDate } from "@/lib/utils";

const TYPE_LABELS: Record<string, { label: string; variant: "low" | "high" | "accent" | "default" | "mid" }> = {
  receive: { label: "Mal kabul", variant: "low" },
  pick: { label: "Toplama", variant: "high" },
  transfer: { label: "Transfer", variant: "accent" },
  adjust: { label: "Düzeltme", variant: "mid" },
  count: { label: "Sayım", variant: "mid" },
};

export function MovementsPage() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const warehouses = useWarehousesQuery();
  const { data, isLoading, isError, error, refetch } = useMovementsQuery({
    page,
    page_size: 25,
    type: type || undefined,
    warehouse_id: warehouseId ? Number(warehouseId) : undefined,
  });

  return (
    <div>
      <PageHeader
        title="Hareketler"
        description="Tüm stok işlemlerinin değiştirilemez denetim izi."
      />

      <div className="mb-3 flex flex-wrap gap-2">
        <Select
          value={type}
          onChange={(e) => {
            setPage(1);
            setType(e.target.value);
          }}
          className="w-40"
          aria-label="İşlem tipi filtresi"
        >
          <option value="">Tüm işlemler</option>
          <option value="receive">Mal kabul</option>
          <option value="pick">Toplama</option>
          <option value="transfer">Transfer</option>
          <option value="adjust">Düzeltme</option>
          <option value="count">Sayım</option>
        </Select>
        <Select
          value={warehouseId}
          onChange={(e) => {
            setPage(1);
            setWarehouseId(e.target.value);
          }}
          className="w-48"
          aria-label="Depo filtresi"
        >
          <option value="">Tüm depolar</option>
          {(warehouses.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <LoadingRows />
      ) : isError ? (
        <ErrorState message={apiErrorMessage(error)} onRetry={refetch} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="Hareket yok"
          hint="Stok İşlemleri sayfasından mal kabul, toplama veya transfer yapınca kayıtlar burada birikir."
        />
      ) : (
        <>
          <DataTable>
            <THead>
              <Th>Tarih</Th>
              <Th>İşlem</Th>
              <Th>SKU</Th>
              <Th>Ürün</Th>
              <Th className="text-right">Miktar</Th>
              <Th>Nereden</Th>
              <Th>Nereye</Th>
              <Th>Kullanıcı</Th>
            </THead>
            <tbody>
              {data.items.map((m) => {
                const t = TYPE_LABELS[m.type] ?? { label: m.type, variant: "default" as const };
                return (
                  <Tr key={m.id}>
                    <Td>
                      <MonoCell className="text-text-muted">{formatDate(m.created_at)}</MonoCell>
                    </Td>
                    <Td>
                      <Badge variant={t.variant}>{t.label}</Badge>
                    </Td>
                    <Td>
                      <MonoCell>{m.product_sku}</MonoCell>
                    </Td>
                    <Td className="max-w-48 truncate">{m.product_name}</Td>
                    <Td className="text-right">
                      <MonoCell>{m.quantity}</MonoCell>
                    </Td>
                    <Td>{m.from_code ? <MonoCell>{m.from_code}</MonoCell> : <span className="text-text-faint">—</span>}</Td>
                    <Td>{m.to_code ? <MonoCell>{m.to_code}</MonoCell> : <span className="text-text-faint">—</span>}</Td>
                    <Td className="max-w-40 truncate text-text-muted">{m.user_email ?? "—"}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </DataTable>
          <Pagination page={page} pageSize={25} total={data.total} onPage={setPage} />
        </>
      )}
    </div>
  );
}
