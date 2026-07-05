import {
  createApi,
  fetchBaseQuery,
  type BaseQueryFn,
  type FetchArgs,
  type FetchBaseQueryError,
} from "@reduxjs/toolkit/query/react";
import { loggedOut } from "@/features/auth/authSlice";
import type { RootState } from "@/app/store";

// Node's fetch (Vitest) rejects relative URLs; the browser resolves them.
const BASE_URL =
  import.meta.env.MODE === "test" ? "http://localhost:3000/api/v1" : "/api/v1";

const rawBaseQuery = fetchBaseQuery({
  baseUrl: BASE_URL,
  prepareHeaders: (headers, { getState }) => {
    const token = (getState() as RootState).auth.token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  },
});

const baseQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
  args,
  api,
  extraOptions,
) => {
  const result = await rawBaseQuery(args, api, extraOptions);
  if (result.error?.status === 401) {
    const state = api.getState() as RootState;
    if (state.auth.token) api.dispatch(loggedOut());
  }
  return result;
};

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery,
  tagTypes: [
    "Warehouse",
    "Location",
    "Product",
    "Stock",
    "Movement",
    "Report",
    "Notification",
    "Region",
    "Customer",
    "Network",
  ],
  endpoints: () => ({}),
});
