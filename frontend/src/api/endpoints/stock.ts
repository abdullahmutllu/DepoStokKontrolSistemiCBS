import { baseApi } from "@/api/baseApi";
import type { Movement, Page, ProductLocation, StockItem } from "@/types";

const stockInvalidations = [
  "Stock" as const,
  { type: "Product" as const, id: "LIST" },
  "Report" as const,
  "Location" as const,
];

export const stockApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    receive: build.mutation<
      StockItem,
      { product_id: number; location_id: number; quantity: number; note?: string }
    >({
      query: (body) => ({ url: "/stock/receive", method: "POST", body }),
      invalidatesTags: stockInvalidations,
    }),
    pick: build.mutation<
      StockItem,
      { product_id: number; location_id: number; quantity: number; note?: string }
    >({
      query: (body) => ({ url: "/stock/pick", method: "POST", body }),
      invalidatesTags: stockInvalidations,
    }),
    transfer: build.mutation<
      StockItem[],
      {
        product_id: number;
        from_location_id: number;
        to_location_id: number;
        quantity: number;
        note?: string;
      }
    >({
      query: (body) => ({ url: "/stock/transfer", method: "POST", body }),
      invalidatesTags: stockInvalidations,
    }),
    adjust: build.mutation<
      StockItem,
      {
        product_id: number;
        location_id: number;
        new_quantity: number;
        type?: "adjust" | "count";
        note?: string;
      }
    >({
      query: (body) => ({ url: "/stock/adjust", method: "POST", body }),
      invalidatesTags: stockInvalidations,
    }),
    movements: build.query<
      Page<Movement>,
      { page?: number; page_size?: number; product_id?: number; warehouse_id?: number; type?: string }
    >({
      query: (params) => ({ url: "/stock/movements", params }),
      providesTags: ["Movement", "Stock"],
    }),
    findProduct: build.query<ProductLocation[], string>({
      query: (q) => ({ url: "/stock/find-product", params: { q } }),
      providesTags: ["Stock"],
    }),
  }),
});

export const {
  useReceiveMutation,
  usePickMutation,
  useTransferMutation,
  useAdjustMutation,
  useMovementsQuery,
  useFindProductQuery,
  useLazyFindProductQuery,
} = stockApi;
