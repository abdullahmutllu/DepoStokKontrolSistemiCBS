import { configureStore } from "@reduxjs/toolkit";
import { baseApi } from "@/api/baseApi";
import authReducer from "@/features/auth/authSlice";
import mapWorkspaceReducer from "@/features/map/mapWorkspaceSlice";
import selectionReducer from "@/features/three/selectionSlice";

export function makeStore() {
  return configureStore({
    reducer: {
      auth: authReducer,
      selection: selectionReducer,
      mapWorkspace: mapWorkspaceReducer,
      [baseApi.reducerPath]: baseApi.reducer,
    },
    middleware: (getDefault) => getDefault().concat(baseApi.middleware),
  });
}

export const store = makeStore();

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
