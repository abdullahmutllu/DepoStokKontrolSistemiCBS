import { baseApi } from "@/api/baseApi";
import type { LatLng, Layout3D, LayoutGenerateResult, LocationDetail, RackPlacement, StorageLocation, Warehouse } from "@/types";

interface WarehousePayload {
  name: string;
  address?: string | null;
  location: LatLng;
  local_width: number;
  local_depth: number;
}

export const warehousesApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    warehouses: build.query<Warehouse[], void>({
      query: () => "/warehouses",
      providesTags: [{ type: "Warehouse", id: "LIST" }],
    }),
    warehouse: build.query<Warehouse, number>({
      query: (id) => `/warehouses/${id}`,
      providesTags: (_r, _e, id) => [{ type: "Warehouse", id }],
    }),
    createWarehouse: build.mutation<Warehouse, WarehousePayload>({
      query: (body) => ({ url: "/warehouses", method: "POST", body }),
      invalidatesTags: [{ type: "Warehouse", id: "LIST" }, "Report"],
    }),
    updateWarehouse: build.mutation<Warehouse, { id: number } & Partial<WarehousePayload>>({
      query: ({ id, ...body }) => ({ url: `/warehouses/${id}`, method: "PATCH", body }),
      invalidatesTags: (_r, _e, { id }) => [{ type: "Warehouse", id }, { type: "Warehouse", id: "LIST" }],
    }),
    deleteWarehouse: build.mutation<void, number>({
      query: (id) => ({ url: `/warehouses/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Warehouse", id: "LIST" }, "Location", "Report"],
    }),
    locations: build.query<StorageLocation[], { warehouseId: number; type?: string }>({
      query: ({ warehouseId, type }) => ({
        url: `/warehouses/${warehouseId}/locations`,
        params: type ? { type } : undefined,
      }),
      providesTags: (_r, _e, { warehouseId }) => [{ type: "Location", id: warehouseId }],
    }),
    layout3d: build.query<Layout3D, number>({
      query: (warehouseId) => `/warehouses/${warehouseId}/layout-3d`,
      providesTags: (_r, _e, warehouseId) => [
        { type: "Location", id: warehouseId },
        { type: "Stock", id: `wh-${warehouseId}` },
      ],
    }),
    locationDetail: build.query<LocationDetail, number>({
      query: (locationId) => `/locations/${locationId}`,
      providesTags: (_r, _e, id) => [{ type: "Stock", id: `loc-${id}` }],
    }),
    generateLayout: build.mutation<
      LayoutGenerateResult,
      { warehouseId: number; cell_size: number; racks: RackPlacement[]; zone_label?: string }
    >({
      query: ({ warehouseId, ...body }) => ({
        url: `/warehouses/${warehouseId}/layout/generate`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_r, _e, { warehouseId }) => [
        { type: "Location", id: warehouseId },
        { type: "Warehouse", id: "LIST" },
        "Report",
      ],
    }),
    deleteZone: build.mutation<void, { warehouseId: number; zoneId: number }>({
      query: ({ warehouseId, zoneId }) => ({
        url: `/warehouses/${warehouseId}/zones/${zoneId}`,
        method: "DELETE",
      }),
      invalidatesTags: (_r, _e, { warehouseId }) => [
        { type: "Location", id: warehouseId },
        { type: "Warehouse", id: "LIST" },
        "Report",
      ],
    }),
  }),
});

export const {
  useWarehousesQuery,
  useWarehouseQuery,
  useCreateWarehouseMutation,
  useUpdateWarehouseMutation,
  useDeleteWarehouseMutation,
  useLocationsQuery,
  useLayout3dQuery,
  useLocationDetailQuery,
  useGenerateLayoutMutation,
  useDeleteZoneMutation,
} = warehousesApi;
