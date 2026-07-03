import { baseApi } from "@/api/baseApi";
import type { CsvImportResult, Page, Product } from "@/types";

export interface ProductPayload {
  sku: string;
  name: string;
  description?: string | null;
  unit: string;
  barcode?: string | null;
  min_stock_threshold: number;
  dim_w?: number | null;
  dim_d?: number | null;
  dim_h?: number | null;
}

export const productsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    products: build.query<
      Page<Product>,
      { page?: number; page_size?: number; search?: string; low_stock?: boolean }
    >({
      query: (params) => ({ url: "/products", params }),
      providesTags: [{ type: "Product", id: "LIST" }],
    }),
    createProduct: build.mutation<Product, ProductPayload>({
      query: (body) => ({ url: "/products", method: "POST", body }),
      invalidatesTags: [{ type: "Product", id: "LIST" }],
    }),
    updateProduct: build.mutation<Product, { id: number } & Partial<ProductPayload>>({
      query: ({ id, ...body }) => ({ url: `/products/${id}`, method: "PATCH", body }),
      invalidatesTags: [{ type: "Product", id: "LIST" }],
    }),
    deleteProduct: build.mutation<void, number>({
      query: (id) => ({ url: `/products/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Product", id: "LIST" }],
    }),
    importProductsCsv: build.mutation<CsvImportResult, File>({
      query: (file) => {
        const form = new FormData();
        form.append("file", file);
        return { url: "/products/import-csv", method: "POST", body: form };
      },
      invalidatesTags: [{ type: "Product", id: "LIST" }],
    }),
  }),
});

export const {
  useProductsQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  useDeleteProductMutation,
  useImportProductsCsvMutation,
} = productsApi;
