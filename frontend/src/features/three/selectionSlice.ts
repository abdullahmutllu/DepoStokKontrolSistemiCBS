import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

interface SelectionState {
  /** Bin the user clicked in the 3D scene (opens the detail panel). */
  selectedId: number | null;
  /** Bins to spotlight (product search or AI results); everything else dims. */
  highlightedIds: number[];
}

const initialState: SelectionState = {
  selectedId: null,
  highlightedIds: [],
};

const selectionSlice = createSlice({
  name: "selection",
  initialState,
  reducers: {
    binSelected(state, action: PayloadAction<number | null>) {
      state.selectedId = action.payload;
    },
    binsHighlighted(state, action: PayloadAction<number[]>) {
      state.highlightedIds = action.payload;
    },
    highlightsCleared(state) {
      state.highlightedIds = [];
    },
  },
});

export const { binSelected, binsHighlighted, highlightsCleared } = selectionSlice.actions;
export default selectionSlice.reducer;
