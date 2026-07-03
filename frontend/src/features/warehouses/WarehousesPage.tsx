import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { useWarehousesQuery } from "@/api/endpoints/warehouses";
import { WarehouseMap } from "@/features/warehouses/WarehouseMap";
import { WarehouseFormDialog } from "@/features/warehouses/WarehouseFormDialog";
import { PageHeader, EmptyState, ErrorState, LoadingRows } from "@/components/shared/states";
import { DataTable, THead, Th, Tr, Td, MonoCell } from "@/components/shared/table";
import { OccupancyBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/apiError";

export function WarehousesPage() {
  const { data, isLoading, isError, error, refetch } = useWarehousesQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div>
      <PageHeader
        title="Depolar"
        description="Konumlar haritada; satıra tıklayınca iç yerleşim ve 3B görünüm açılır."
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus size={14} /> Depo ekle
          </Button>
        }
      />

      <div className="mb-4 h-72 overflow-hidden rounded-md border border-ink-600 bg-ink-950">
        <WarehouseMap
          className="h-full w-full"
          warehouses={data ?? []}
          onMarkerClick={(wh) => navigate(`/warehouses/${wh.id}`)}
        />
      </div>

      {isLoading ? (
        <LoadingRows />
      ) : isError ? (
        <ErrorState message={apiErrorMessage(error)} onRetry={refetch} />
      ) : !data || data.length === 0 ? (
        <EmptyState
          title="Henüz depo yok"
          hint="Depo ekleyin; haritaya tıklayarak konumunu işaretleyin."
          action={
            <Button onClick={() => setDialogOpen(true)}>
              <Plus size={14} /> Depo ekle
            </Button>
          }
        />
      ) : (
        <DataTable>
          <THead>
            <Th>Depo</Th>
            <Th>Adres</Th>
            <Th className="text-right">Boyut (m)</Th>
            <Th className="text-right">Göz</Th>
            <Th className="text-right">Toplam adet</Th>
            <Th>Doluluk</Th>
          </THead>
          <tbody>
            {data.map((wh) => (
              <Tr key={wh.id} onClick={() => navigate(`/warehouses/${wh.id}`)}>
                <Td className="font-medium">{wh.name}</Td>
                <Td className="text-text-muted">{wh.address ?? "—"}</Td>
                <Td className="text-right">
                  <MonoCell>
                    {wh.local_width}×{wh.local_depth}
                  </MonoCell>
                </Td>
                <Td className="text-right">
                  <MonoCell>{wh.bin_count ?? 0}</MonoCell>
                </Td>
                <Td className="text-right">
                  <MonoCell>{wh.total_quantity ?? 0}</MonoCell>
                </Td>
                <Td>
                  {wh.occupancy_percent == null ? (
                    <span className="text-[12px] text-text-faint">yerleşim yok</span>
                  ) : (
                    <OccupancyBadge
                      bucket={
                        wh.occupancy_percent > 85
                          ? "high"
                          : wh.occupancy_percent >= 60
                            ? "mid"
                            : wh.occupancy_percent > 0
                              ? "low"
                              : "empty"
                      }
                      percent={wh.occupancy_percent}
                    />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}

      <WarehouseFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
