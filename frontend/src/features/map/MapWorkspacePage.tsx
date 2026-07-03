import { Link } from "react-router-dom";
import { useWarehousesQuery } from "@/api/endpoints/warehouses";
import { GisMap } from "@/features/map/GisMap";
import { MapToolbar } from "@/features/map/MapToolbar";
import { AnalysisPanel } from "@/features/map/AnalysisPanel";
import { EmptyState, ErrorState, LoadingRows } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/apiError";

/** Full-screen GIS workspace: tool rail + map + analysis panel. */
export function MapWorkspacePage() {
  const { data, isLoading, isError, error, refetch } = useWarehousesQuery();

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingRows rows={6} />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-6">
        <ErrorState message={apiErrorMessage(error)} onRetry={refetch} />
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="Haritada gösterilecek depo yok"
          hint="Önce bir depo ekleyin; konumu haritaya tıklayarak seçebilirsiniz."
          action={
            <Button asChild>
              <Link to="/warehouses">Depo ekle</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    // Escape AppShell's main padding: the workspace owns the full viewport band.
    <div className="relative -m-4 flex h-[calc(100vh-3rem)] overflow-hidden md:-m-6">
      <div className="relative min-w-0 flex-1">
        <GisMap warehouses={data} />
        <MapToolbar />
      </div>
      <AnalysisPanel />
    </div>
  );
}
