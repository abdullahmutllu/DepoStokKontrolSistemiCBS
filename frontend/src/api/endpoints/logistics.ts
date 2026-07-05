import { baseApi } from "@/api/baseApi";
import type {
  CustomerOrder,
  Kpi,
  ProductForecast,
  ReorderSuggestion,
  ScenarioResult,
  Shipment,
  ShipmentDetail,
  Tour,
  VehicleRoutes,
  WavePick,
} from "@/types";

export const logisticsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    vehicleRoutes: build.mutation<
      VehicleRoutes,
      { warehouse_id: number; vehicle_count: number; capacity: number }
    >({
      query: (body) => ({ url: "/network/vehicle-routes", method: "POST", body }),
    }),
    createShipments: build.mutation<
      Shipment[],
      { warehouse_id: number; tours: Tour[]; time_scale?: number }
    >({
      query: (body) => ({ url: "/shipments", method: "POST", body }),
      invalidatesTags: ["Shipment"],
    }),
    activeShipments: build.query<Shipment[], void>({
      query: () => "/shipments/active",
      providesTags: ["Shipment"],
    }),
    shipmentDetail: build.query<ShipmentDetail, number>({
      query: (id) => `/shipments/${id}`,
    }),
    clearShipments: build.mutation<void, void>({
      query: () => ({ url: "/shipments", method: "DELETE" }),
      invalidatesTags: ["Shipment"],
    }),
    scenario: build.mutation<ScenarioResult, { closed_warehouse_ids: number[] }>({
      query: (body) => ({ url: "/network/scenario", method: "POST", body }),
    }),
    productForecast: build.query<ProductForecast, number>({
      query: (id) => `/products/${id}/forecast`,
      providesTags: ["Report"],
    }),
    reorderSuggestions: build.query<ReorderSuggestion[], void>({
      query: () => "/reports/reorder-suggestions",
      providesTags: ["Report", "Stock"],
    }),
    kpi: build.query<Kpi, void>({
      query: () => "/reports/kpi",
      providesTags: ["Report", "Stock", "Shipment", "Order"],
    }),
    orders: build.query<CustomerOrder[], { status?: string } | void>({
      query: (params) => ({ url: "/orders", params: params ?? undefined }),
      providesTags: ["Order"],
    }),
    createOrder: build.mutation<
      CustomerOrder,
      {
        warehouse_id: number;
        customer_name: string;
        lines: { product_id: number; quantity: number }[];
      }
    >({
      query: (body) => ({ url: "/orders", method: "POST", body }),
      invalidatesTags: ["Order"],
    }),
    wavePick: build.mutation<WavePick, { order_ids: number[] }>({
      query: (body) => ({ url: "/orders/wave-pick", method: "POST", body }),
      invalidatesTags: ["Order"],
    }),
    markOrderPicked: build.mutation<CustomerOrder, number>({
      query: (id) => ({ url: `/orders/${id}/picked`, method: "POST" }),
      invalidatesTags: ["Order"],
    }),
  }),
});

export const {
  useVehicleRoutesMutation,
  useCreateShipmentsMutation,
  useActiveShipmentsQuery,
  useShipmentDetailQuery,
  useClearShipmentsMutation,
  useScenarioMutation,
  useProductForecastQuery,
  useReorderSuggestionsQuery,
  useKpiQuery,
  useOrdersQuery,
  useCreateOrderMutation,
  useWavePickMutation,
  useMarkOrderPickedMutation,
} = logisticsApi;
