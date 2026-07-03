import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MapWorkspacePage } from "@/features/map/MapWorkspacePage";
import { AnalysisPanel } from "@/features/map/AnalysisPanel";
import { ringDrawn, toolSelected } from "@/features/map/mapWorkspaceSlice";
import mapWorkspaceReducer, {
  drawingsCleared,
  measureUpdated,
} from "@/features/map/mapWorkspaceSlice";
import { renderWithProviders } from "@/test/testUtils";
import { server } from "@/test/mocks/server";

const RING = [
  { lat: 39.915, lng: 32.845 },
  { lat: 39.915, lng: 32.855 },
  { lat: 39.925, lng: 32.855 },
];

interface MockDraw {
  mode: string;
}

describe("mapWorkspaceSlice", () => {
  it("ringDrawn stores the ring and resets the tool", () => {
    let state = mapWorkspaceReducer(undefined, toolSelected("polygon"));
    expect(state.activeTool).toBe("polygon");
    state = mapWorkspaceReducer(state, ringDrawn(RING));
    expect(state.analysisRing).toEqual(RING);
    expect(state.activeTool).toBe("pan");
  });

  it("switching away from measure clears the readout", () => {
    let state = mapWorkspaceReducer(undefined, toolSelected("measure-line"));
    state = mapWorkspaceReducer(state, measureUpdated({ kind: "line", value: 1234 }));
    expect(state.measure?.value).toBe(1234);
    state = mapWorkspaceReducer(state, toolSelected("pan"));
    expect(state.measure).toBeNull();
  });

  it("drawingsCleared resets ring and measure", () => {
    let state = mapWorkspaceReducer(undefined, ringDrawn(RING));
    state = mapWorkspaceReducer(state, drawingsCleared());
    expect(state.analysisRing).toBeNull();
  });
});

describe("MapWorkspacePage", () => {
  it("renders map, toolbar and empty analysis panel", async () => {
    renderWithProviders(<MapWorkspacePage />);
    expect(await screen.findByTestId("gis-map")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Poligon çiz" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mesafe ölç" })).toBeInTheDocument();
    expect(screen.getByText("Haritada bir bölge çizin")).toBeInTheDocument();
    // basemap switcher present
    expect(screen.getByRole("button", { name: "Uydu" })).toBeInTheDocument();
  });

  it("selecting a draw tool switches the terra-draw mode", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapWorkspacePage />);
    await screen.findByTestId("gis-map");
    await waitFor(() => {
      expect((window as unknown as Record<string, unknown>).__mockDraw).toBeTruthy();
    });
    await user.click(screen.getByRole("button", { name: "Poligon çiz" }));
    const draw = (window as unknown as Record<string, unknown>).__mockDraw as MockDraw;
    await waitFor(() => expect(draw.mode).toBe("polygon"));
  });

  it("marker click opens the rich warehouse popup", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MapWorkspacePage />);
    await screen.findByTestId("gis-map");
    const marker = await screen.findByTestId("wh-marker-3");
    await user.click(marker);
    const popup = await screen.findByTestId("warehouse-popup");
    expect(popup).toHaveTextContent("İstanbul Ana Depo");
    expect(popup).toHaveTextContent("Depoya git");
  });
});

describe("AnalysisPanel", () => {
  it("runs the analysis when a ring is drawn and shows aggregates", async () => {
    const { store } = renderWithProviders(<AnalysisPanel />);
    store.dispatch(ringDrawn(RING));

    expect(await screen.findByText("2.271")).toBeInTheDocument(); // tr-TR grouping
    expect(screen.getByText("%12.5")).toBeInTheDocument();
    expect(screen.getByText("İstanbul Ana Depo")).toBeInTheDocument();
    expect(screen.getByText(/merkeze/)).toBeInTheDocument();
  }, 10_000);

  it("saves the drawn region with a name", async () => {
    const user = userEvent.setup();
    let captured: { name: string; ring: unknown[] } | null = null;
    server.use(
      http.post("/api/v1/regions", async ({ request }) => {
        captured = (await request.json()) as typeof captured;
        return HttpResponse.json(
          { id: 9, name: captured!.name, ring: captured!.ring, created_at: "2026-01-01T00:00:00Z" },
          { status: 201 },
        );
      }),
    );

    const { store } = renderWithProviders(<AnalysisPanel />);
    store.dispatch(ringDrawn(RING));
    await screen.findByText("İstanbul Ana Depo");

    await user.type(screen.getByLabelText("Bu bölgeyi kaydet"), "Marmara");
    await user.click(screen.getByRole("button", { name: /Kaydet/ }));

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.name).toBe("Marmara");
    expect(captured!.ring).toHaveLength(RING.length);
  });

  it("loads a saved region back into analysis", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/v1/regions", () =>
        HttpResponse.json([
          { id: 5, name: "Ankara Saham", ring: RING, created_at: "2026-01-01T00:00:00Z" },
        ]),
      ),
    );
    const { store } = renderWithProviders(<AnalysisPanel />);
    await user.click(await screen.findByRole("button", { name: "Ankara Saham" }));
    expect(store.getState().mapWorkspace.analysisRing).toEqual(RING);
    expect(await screen.findByText("İstanbul Ana Depo")).toBeInTheDocument();
  });
});
