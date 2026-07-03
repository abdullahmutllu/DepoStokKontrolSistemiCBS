import { useParams, Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useWarehouseQuery } from "@/api/endpoints/warehouses";
import { WarehouseMap } from "@/features/warehouses/WarehouseMap";
import { BuilderTab } from "@/features/layout/BuilderTab";
import { DxfTab } from "@/features/layout/DxfTab";
import { Warehouse3DTab } from "@/features/three/Warehouse3DTab";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ErrorState, LoadingRows, PageHeader } from "@/components/shared/states";
import { MonoCell } from "@/components/shared/table";
import { apiErrorMessage } from "@/lib/apiError";

export function WarehouseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const warehouseId = Number(id);
  const { data, isLoading, isError, error, refetch } = useWarehouseQuery(warehouseId, {
    skip: !Number.isFinite(warehouseId),
  });

  if (isLoading) return <LoadingRows rows={6} />;
  if (isError || !data)
    return <ErrorState message={apiErrorMessage(error)} onRetry={refetch} />;

  return (
    <div>
      <Link
        to="/warehouses"
        className="mb-2 inline-flex items-center gap-1 text-[12.5px] text-text-muted hover:text-text"
      >
        <ArrowLeft size={13} /> Depolar
      </Link>
      <PageHeader
        title={data.name}
        description={data.address ?? undefined}
        actions={
          <MonoCell className="rounded border border-ink-600 bg-ink-800 px-2 py-1 text-[11.5px] text-text-muted">
            {data.local_width}×{data.local_depth} m
          </MonoCell>
        }
      />

      <Tabs defaultValue="3d">
        <TabsList>
          <TabsTrigger value="3d">3B Görünüm</TabsTrigger>
          <TabsTrigger value="layout">Yerleşim</TabsTrigger>
          <TabsTrigger value="dxf">DXF İçe Aktar</TabsTrigger>
          <TabsTrigger value="map">Harita</TabsTrigger>
        </TabsList>

        <TabsContent value="3d">
          <Warehouse3DTab warehouseId={warehouseId} />
        </TabsContent>
        <TabsContent value="layout">
          <BuilderTab warehouse={data} />
        </TabsContent>
        <TabsContent value="dxf">
          <DxfTab warehouse={data} />
        </TabsContent>
        <TabsContent value="map">
          <div className="h-[440px] overflow-hidden rounded-md border border-ink-600 bg-ink-950">
            <WarehouseMap
              className="h-full w-full"
              warehouses={[data]}
              center={data.location}
              zoom={14}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
