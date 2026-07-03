import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { LatLng } from "@/types";

export type MapTool =
  | "pan"
  | "select"
  | "polygon"
  | "rectangle"
  | "circle"
  | "measure-line";

export interface MeasureReadout {
  kind: "line" | "area";
  value: number; // meters or m²
}

interface MapWorkspaceState {
  activeTool: MapTool;
  basemapId: string;
  selectedWarehouseId: number | null;
  measure: MeasureReadout | null;
  /** Last finished polygon/rectangle/circle ring — drives the analysis panel. */
  analysisRing: LatLng[] | null;
}

const initialState: MapWorkspaceState = {
  activeTool: "pan",
  basemapId: "osm",
  selectedWarehouseId: null,
  measure: null,
  analysisRing: null,
};

const mapWorkspaceSlice = createSlice({
  name: "mapWorkspace",
  initialState,
  reducers: {
    toolSelected(state, action: PayloadAction<MapTool>) {
      state.activeTool = action.payload;
      if (action.payload !== "measure-line") state.measure = null;
    },
    basemapChanged(state, action: PayloadAction<string>) {
      state.basemapId = action.payload;
    },
    warehouseSelected(state, action: PayloadAction<number | null>) {
      state.selectedWarehouseId = action.payload;
    },
    measureUpdated(state, action: PayloadAction<MeasureReadout | null>) {
      state.measure = action.payload;
    },
    ringDrawn(state, action: PayloadAction<LatLng[]>) {
      state.analysisRing = action.payload;
      state.activeTool = "pan";
    },
    drawingsCleared(state) {
      state.analysisRing = null;
      state.measure = null;
    },
  },
});

export const {
  toolSelected,
  basemapChanged,
  warehouseSelected,
  measureUpdated,
  ringDrawn,
  drawingsCleared,
} = mapWorkspaceSlice.actions;
export default mapWorkspaceSlice.reducer;
