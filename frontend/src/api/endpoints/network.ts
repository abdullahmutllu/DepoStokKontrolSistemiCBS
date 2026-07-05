import { baseApi } from "@/api/baseApi";
import type {
  CenterOfGravity,
  ClosestFacility,
  Coverage,
  CsvImportResult,
  Customer,
  DemandPoint,
  FlowArc,
  PickRoute,
} from "@/types";

export const networkApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    customers: build.query<Customer[], void>({
      query: () => "/customers",
      providesTags: ["Customer"],
    }),
    importCustomersCsv: build.mutation<CsvImportResult, File>({
      query: (file) => {
        const form = new FormData();
        form.append("file", file);
        return { url: "/customers/import-csv", method: "POST", body: form };
      },
      invalidatesTags: ["Customer", "Network"],
    }),
    demandPoints: build.query<DemandPoint[], void>({
      query: () => "/network/demand-points",
      providesTags: ["Network", "Customer"],
    }),
    centerOfGravity: build.mutation<CenterOfGravity, { n_sites: number }>({
      query: (body) => ({ url: "/network/center-of-gravity", method: "POST", body }),
    }),
    closestFacility: build.query<ClosestFacility, void>({
      query: () => "/network/closest-facility",
      providesTags: ["Network", "Customer", "Warehouse"],
    }),
    coverage: build.query<Coverage, void>({
      query: () => "/network/coverage",
      providesTags: ["Network", "Customer", "Warehouse"],
    }),
    flowMap: build.query<{ arcs: FlowArc[] }, void>({
      query: () => "/network/flow-map",
      providesTags: ["Network", "Movement"],
    }),
    pickRoute: build.mutation<
      PickRoute,
      { warehouseId: number; location_ids?: number[]; items?: { product_id: number; quantity: number }[] }
    >({
      query: ({ warehouseId, ...body }) => ({
        url: `/warehouses/${warehouseId}/pick-route`,
        method: "POST",
        body,
      }),
    }),
  }),
});

export const {
  useCustomersQuery,
  useImportCustomersCsvMutation,
  useDemandPointsQuery,
  useCenterOfGravityMutation,
  useClosestFacilityQuery,
  useCoverageQuery,
  useFlowMapQuery,
  usePickRouteMutation,
} = networkApi;
