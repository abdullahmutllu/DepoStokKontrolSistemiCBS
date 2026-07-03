import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Warehouse3DTab } from "@/features/three/Warehouse3DTab";
import { DetailPanel } from "@/features/three/DetailPanel";
import { binSelected } from "@/features/three/selectionSlice";
import { renderWithProviders } from "@/test/testUtils";

describe("Warehouse3DTab", () => {
  it("renders the scene placeholder once layout data arrives", async () => {
    renderWithProviders(<Warehouse3DTab warehouseId={3} />);
    expect(await screen.findByTestId("r3f-canvas")).toBeInTheDocument();
    // legend communicates the occupancy scale
    expect(screen.getByText("Boş")).toBeInTheDocument();
    expect(screen.getByText("%60 altı")).toBeInTheDocument();
    expect(screen.getByText("%85 üstü")).toBeInTheDocument();
    expect(screen.getByText(/3 göz/)).toBeInTheDocument();
  });

  it("product search populates highlightedIds for matching bins", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Warehouse3DTab warehouseId={3} />);
    await screen.findByTestId("r3f-canvas");

    await user.type(screen.getByLabelText("Ürün ara"), "RLM-6204");
    await user.click(screen.getByRole("button", { name: "3B'de göster" }));

    await waitFor(() =>
      expect(store.getState().selection.highlightedIds).toEqual([101, 103]),
    );
    expect(await screen.findByText(/Vurguyu temizle \(2 göz\)/)).toBeInTheDocument();

    // clearing resets the spotlight
    await user.click(screen.getByRole("button", { name: /Vurguyu temizle/ }));
    expect(store.getState().selection.highlightedIds).toEqual([]);
  });

  it("no-match search leaves highlights empty and informs the user", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<Warehouse3DTab warehouseId={3} />);
    await screen.findByTestId("r3f-canvas");

    await user.type(screen.getByLabelText("Ürün ara"), "OLMAYAN-URUN");
    await user.click(screen.getByRole("button", { name: "3B'de göster" }));

    await waitFor(() => expect(store.getState().selection.highlightedIds).toEqual([]));
    expect(await screen.findByText("Ürün stokta bulunamadı.")).toBeInTheDocument();
  });
});

describe("DetailPanel", () => {
  it("shows the selected bin's contents (assign → inspect flow)", async () => {
    const { store } = renderWithProviders(<DetailPanel />);
    store.dispatch(binSelected(101));

    expect(await screen.findByText("Z1-A1-R1-S1-B1")).toBeInTheDocument();
    expect(await screen.findByText("RLM-6204")).toBeInTheDocument();
    expect(screen.getByText("Rulman 6204 2RS")).toBeInTheDocument();
    expect(screen.getByText(/30 adet/)).toBeInTheDocument();
    expect(screen.getByText(/30\/100/)).toBeInTheDocument();
  });
});
