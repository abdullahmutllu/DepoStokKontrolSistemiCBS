import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface BinAlertContext {
  sku: string;
  total: number;
  threshold: number;
  level: "critical" | "warning";
}

interface SelectionState {
  /** Bin the user clicked in the 3D scene (opens the detail panel). */
  selectedId: number | null;
  /** Bins to spotlight (product search or AI results); everything else dims. */
  highlightedIds: number[];
  /** Uyarı pininden gelen seçimde düşük-stok bağlamı (detay panelinde rozet). */
  selectedAlert: BinAlertContext | null;
}

const initialState: SelectionState = {
  selectedId: null,
  highlightedIds: [],
  selectedAlert: null,
};

const selectionSlice = createSlice({
  name: "selection",
  initialState,
  reducers: {
    binSelected(state, action: PayloadAction<number | null>) {
      state.selectedId = action.payload;
      state.selectedAlert = null; // normal seçim uyarı bağlamını temizler
    },
    alertBinSelected(
      state,
      action: PayloadAction<{ binId: number; alert: BinAlertContext | null }>,
    ) {
      state.selectedId = action.payload.binId;
      state.selectedAlert = action.payload.alert;
    },
    binsHighlighted(state, action: PayloadAction<number[]>) {
      state.highlightedIds = action.payload;
    },
    highlightsCleared(state) {
      state.highlightedIds = [];
    },
  },
});

export const { binSelected, alertBinSelected, binsHighlighted, highlightsCleared } =
  selectionSlice.actions;
export default selectionSlice.reducer;
