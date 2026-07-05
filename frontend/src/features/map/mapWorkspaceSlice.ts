import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { CenterOfGravity, LatLng } from "@/types";

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

export type PanelTab = "region" | "network";

export interface NetworkLayerToggles {
  customers: boolean;
  heatmap: boolean;
  assignments: boolean;
  voronoi: boolean;
  coverage: boolean;
  flow: boolean;
}

interface MapWorkspaceState {
  activeTool: MapTool;
  basemapId: string;
  selectedWarehouseId: number | null;
  measure: MeasureReadout | null;
  /** Last finished polygon/rectangle/circle ring — drives the analysis panel. */
  analysisRing: LatLng[] | null;
  panelTab: PanelTab;
  networkLayers: NetworkLayerToggles;
  /** Latest greenfield result — rendered on the map as proposed sites + lines. */
  cogResult: CenterOfGravity | null;
}

const initialState: MapWorkspaceState = {
  activeTool: "pan",
  basemapId: "osm",
  selectedWarehouseId: null,
  measure: null,
  analysisRing: null,
  panelTab: "region",
  networkLayers: {
    customers: true,
    heatmap: false,
    assignments: false,
    voronoi: false,
    coverage: false,
    flow: false,
  },
  cogResult: null,
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
    panelTabChanged(state, action: PayloadAction<PanelTab>) {
      state.panelTab = action.payload;
    },
    networkLayerToggled(state, action: PayloadAction<keyof NetworkLayerToggles>) {
      state.networkLayers[action.payload] = !state.networkLayers[action.payload];
    },
    cogComputed(state, action: PayloadAction<CenterOfGravity | null>) {
      state.cogResult = action.payload;
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
  panelTabChanged,
  networkLayerToggled,
  cogComputed,
} = mapWorkspaceSlice.actions;
export default mapWorkspaceSlice.reducer;
