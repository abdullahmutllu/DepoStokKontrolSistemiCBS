import { baseApi } from "@/api/baseApi";
import type { LatLng, Region, RegionAnalysis } from "@/types";

export const geoApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    regionAnalysis: build.mutation<RegionAnalysis, { ring: LatLng[] }>({
      query: (body) => ({ url: "/geo/region-analysis", method: "POST", body }),
    }),
    regions: build.query<Region[], void>({
      query: () => "/regions",
      providesTags: ["Region"],
    }),
    createRegion: build.mutation<Region, { name: string; ring: LatLng[] }>({
      query: (body) => ({ url: "/regions", method: "POST", body }),
      invalidatesTags: ["Region"],
    }),
    updateRegion: build.mutation<Region, { id: number; name?: string; ring?: LatLng[] }>({
      query: ({ id, ...body }) => ({ url: `/regions/${id}`, method: "PATCH", body }),
      invalidatesTags: ["Region"],
    }),
    deleteRegion: build.mutation<void, number>({
      query: (id) => ({ url: `/regions/${id}`, method: "DELETE" }),
      invalidatesTags: ["Region"],
    }),
  }),
});

export const {
  useRegionAnalysisMutation,
  useRegionsQuery,
  useCreateRegionMutation,
  useUpdateRegionMutation,
  useDeleteRegionMutation,
} = geoApi;
