import { baseApi } from "@/api/baseApi";
import type {
  LowStockRow,
  MovementHistoryPoint,
  MoverRow,
  OccupancyRow,
  StockByLocationRow,
  WarehouseSummary,
} from "@/types";

export const reportsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    warehouseSummaries: build.query<WarehouseSummary[], void>({
      query: () => "/reports/warehouse-summaries",
      providesTags: ["Report"],
    }),
    stockByLocation: build.query<
      StockByLocationRow[],
      { warehouse_id: number; group_type: "zone" | "aisle" | "rack" }
    >({
      query: (params) => ({ url: "/reports/stock-by-location", params }),
      providesTags: ["Report"],
    }),
    occupancy: build.query<OccupancyRow[], { warehouse_id: number }>({
      query: (params) => ({ url: "/reports/occupancy", params }),
      providesTags: ["Report"],
    }),
    lowStock: build.query<LowStockRow[], void>({
      query: () => "/reports/low-stock",
      providesTags: ["Report"],
    }),
    topMovers: build.query<MoverRow[], { days?: number; limit?: number; ascending?: boolean }>({
      query: (params) => ({ url: "/reports/top-movers", params }),
      providesTags: ["Report"],
    }),
    movementHistory: build.query<MovementHistoryPoint[], { days?: number }>({
      query: (params) => ({ url: "/reports/movement-history", params }),
      providesTags: ["Report", "Movement"],
    }),
  }),
});

export const {
  useWarehouseSummariesQuery,
  useStockByLocationQuery,
  useOccupancyQuery,
  useLowStockQuery,
  useTopMoversQuery,
  useMovementHistoryQuery,
} = reportsApi;
