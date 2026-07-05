import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NetworkPanel } from "@/features/map/NetworkPanel";
import { AnalysisPanel } from "@/features/map/AnalysisPanel";
import { MapWorkspacePage } from "@/features/map/MapWorkspacePage";
import mapWorkspaceReducer, {
  cogComputed,
  networkLayerToggled,
  panelTabChanged,
} from "@/features/map/mapWorkspaceSlice";
import { renderWithProviders } from "@/test/testUtils";
import { demoCog } from "@/test/mocks/handlers";

interface MockMapWithLayers {
  sources: Record<string, { data: GeoJSON.FeatureCollection }>;
  layoutProps: Record<string, string>;
}

describe("mapWorkspaceSlice — ağ analizi", () => {
  it("networkLayerToggled yalnız ilgili bayrağı çevirir", () => {
    let state = mapWorkspaceReducer(undefined, networkLayerToggled("heatmap"));
    expect(state.networkLayers.heatmap).toBe(true);
    expect(state.networkLayers.customers).toBe(true); // varsayılan korunur
    state = mapWorkspaceReducer(state, networkLayerToggled("heatmap"));
    expect(state.networkLayers.heatmap).toBe(false);
  });

  it("panelTabChanged ve cogComputed durumu günceller", () => {
    let state = mapWorkspaceReducer(undefined, panelTabChanged("network"));
    expect(state.panelTab).toBe("network");
    state = mapWorkspaceReducer(state, cogComputed(demoCog));
    expect(state.cogResult?.improvement_percent).toBe(25);
    state = mapWorkspaceReducer(state, cogComputed(null));
    expect(state.cogResult).toBeNull();
  });
});

describe("NetworkPanel", () => {
  it("katman anahtarlarını ve müşteri sayısını gösterir", async () => {
    renderWithProviders(<NetworkPanel />);
    expect(screen.getByText("Müşteri noktaları")).toBeInTheDocument();
    expect(screen.getByText("Talep ısı haritası")).toBeInTheDocument();
    expect(screen.getByText("Kapsama alanları")).toBeInTheDocument();
    const row = await screen.findByText(/müşteri noktası/);
    await waitFor(() => expect(row).toHaveTextContent("3 müşteri noktası"));
  });

  it("katman anahtarı store'daki bayrağı değiştirir", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<NetworkPanel />);
    await user.click(screen.getByRole("checkbox", { name: /Talep ısı haritası/ }));
    expect(store.getState().mapWorkspace.networkLayers.heatmap).toBe(true);
  });

  it("ağırlık merkezi analizi sonuç kartını doldurur", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<NetworkPanel />);
    await user.click(screen.getByRole("button", { name: "Analiz et" }));

    const card = await screen.findByTestId("cog-result");
    expect(card).toHaveTextContent("%25");
    expect(card).toHaveTextContent("40.1100, 29.6100");
    expect(store.getState().mapWorkspace.cogResult?.n_sites).toBe(1);

    await user.click(screen.getByRole("button", { name: /Öneriyi temizle/ }));
    expect(store.getState().mapWorkspace.cogResult).toBeNull();
  });

  it("kapsama açılınca mod notunu ve kapsam dışı müşteriyi gösterir", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NetworkPanel />);
    await user.click(screen.getByRole("checkbox", { name: /Kapsama alanları/ }));
    expect(await screen.findByText(/Kuş uçuşu halkalar/)).toBeInTheDocument();
    expect(screen.getByText(/2 müşteri kapsama dışı/)).toBeInTheDocument();
  });

  it("atama katmanı açılınca depo yük özetini listeler", async () => {
    const user = userEvent.setup();
    renderWithProviders(<NetworkPanel />);
    await user.click(screen.getByRole("checkbox", { name: /En yakın depo ataması/ }));
    expect(await screen.findByText("Depo yükleri (en yakın atama)")).toBeInTheDocument();
    expect(screen.getByText(/3 müşteri · 58 talep/)).toBeInTheDocument();
  });
});

describe("AnalysisPanel sekmeleri", () => {
  it("Ağ Analizi sekmesi NetworkPanel'i açar, Bölge geri döner", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AnalysisPanel />);
    expect(screen.getByText("Haritada bir bölge çizin")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Ağ Analizi" }));
    expect(await screen.findByText("Analiz katmanları")).toBeInTheDocument();
    expect(screen.queryByText("Haritada bir bölge çizin")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Bölge" }));
    expect(screen.getByText("Haritada bir bölge çizin")).toBeInTheDocument();
  });

  it("Sevkiyat sekmesi LogisticsPanel'i açar", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AnalysisPanel />);
    await user.click(screen.getByRole("tab", { name: "Sevkiyat" }));
    expect(await screen.findByText(/Teslimat turları planla/)).toBeInTheDocument();
  });
});

describe("NetworkPanel — what-if senaryosu", () => {
  it("depo kapatınca senaryo kartı delta ve yeniden atamayı gösterir", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<NetworkPanel />);
    const card = await screen.findByTestId("scenario-card");
    // Depo listesi yüklenince ilk depoyu kapat
    await waitFor(() =>
      expect(card.querySelector('input[type="checkbox"]')).not.toBeNull(),
    );
    const box = card.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await user.click(box);
    expect(store.getState().mapWorkspace.scenarioClosedIds).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Senaryoyu hesapla" }));
    const result = await screen.findByTestId("scenario-result");
    expect(result).toHaveTextContent("%28.2");
    expect(result).toHaveTextContent("9");
    expect(result).toHaveTextContent("12→19");

    await user.click(screen.getByRole("button", { name: /Senaryoyu temizle/ }));
    expect(store.getState().mapWorkspace.scenarioClosedIds).toEqual([]);
  });
});

describe("GisMap ağ katmanları", () => {
  it("müşteri noktaları haritaya kaynak olarak senkronlanır", async () => {
    renderWithProviders(<MapWorkspacePage />);
    await screen.findByTestId("gis-map");

    await waitFor(() => {
      const map = (window as unknown as Record<string, unknown>)
        .__mockMap as MockMapWithLayers;
      expect(map.sources["net-demand"]).toBeTruthy();
      expect(map.sources["net-demand"].data.features).toHaveLength(3);
    });

    const map = (window as unknown as Record<string, unknown>)
      .__mockMap as MockMapWithLayers;
    expect(map.layoutProps["net-demand-circle"]).toBe("visible"); // varsayılan açık
    expect(map.layoutProps["net-heat"]).toBe("none");
  });
});
