import { baseApi } from "@/api/baseApi";
import type { AskResponse, DxfPreview, LayoutGenerateResult, SlottingResponse, SummaryResponse } from "@/types";

export const aiApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    ask: build.mutation<AskResponse, { question: string }>({
      query: (body) => ({ url: "/ai/ask", method: "POST", body }),
    }),
    slotting: build.mutation<SlottingResponse, { product_id: number; warehouse_id: number }>({
      query: (body) => ({ url: "/ai/slotting", method: "POST", body }),
    }),
    aiSummary: build.query<SummaryResponse, void>({
      query: () => "/ai/summary",
    }),
    parseDxf: build.mutation<DxfPreview, { warehouseId: number; file: File }>({
      query: ({ warehouseId, file }) => {
        const form = new FormData();
        form.append("file", file);
        return { url: `/warehouses/${warehouseId}/dxf/parse`, method: "POST", body: form };
      },
    }),
    generateFromDxf: build.mutation<
      LayoutGenerateResult,
      {
        warehouseId: number;
        preview: DxfPreview;
        zone_label?: string;
        shelf_count: number;
        bins_per_shelf: number;
        shelf_height: number;
        bin_capacity: number | null;
      }
    >({
      query: ({ warehouseId, ...body }) => ({
        url: `/warehouses/${warehouseId}/dxf/generate`,
        method: "POST",
        body,
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
  useAskMutation,
  useSlottingMutation,
  useAiSummaryQuery,
  useParseDxfMutation,
  useGenerateFromDxfMutation,
} = aiApi;
