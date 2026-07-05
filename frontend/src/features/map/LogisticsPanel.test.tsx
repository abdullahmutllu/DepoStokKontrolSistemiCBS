import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { LogisticsPanel } from "@/features/map/LogisticsPanel";
import { renderWithProviders } from "@/test/testUtils";
import { server } from "@/test/mocks/server";
import { demoShipment } from "@/test/mocks/handlers";
import {
  routesFC,
  routeStopsFC,
  shipmentRoutes,
  tourColor,
  tourRoutes,
  vehicleMarkerHtml,
} from "@/features/map/trackingLayers";
import { demoTour } from "@/test/mocks/handlers";

describe("trackingLayers saf kurucular", () => {
  it("tourRoutes depoyu başa ve sona ekler", () => {
    const depot = { lat: 41.06, lng: 28.79 };
    const routes = tourRoutes([demoTour], depot);
    expect(routes[0].points[0]).toEqual(depot);
    expect(routes[0].points.at(-1)).toEqual(depot);
    expect(routes[0].points).toHaveLength(demoTour.stops.length + 2);
  });

  it("routesFC araca göre renkli LineString üretir", () => {
    const fc = routesFC(shipmentRoutes([demoShipment]));
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry.type).toBe("LineString");
    expect(fc.features[0].properties?.color).toBe(tourColor(0));
  });

  it("routeStopsFC depot noktalarını dışlar ve sıra numarası verir", () => {
    const fc = routeStopsFC(shipmentRoutes([demoShipment]));
    expect(fc.features).toHaveLength(2); // 4 nokta − 2 depot
    expect(fc.features[0].properties?.order).toBe(1);
  });

  it("vehicleMarkerHtml yön ve ilerlemeyi gömer", () => {
    const html = vehicleMarkerHtml(demoShipment, 0);
    expect(html).toContain("rotate(118.5deg)");
    expect(html).toContain("%42");
    expect(html).toContain("Araç 1");
  });
});

describe("LogisticsPanel", () => {
  it("tur hesapla → önizleme kartları → sevkiyatı başlat → canlı filo", async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<LogisticsPanel />);

    await screen.findByRole("button", { name: "Turları hesapla" });
    await user.click(screen.getByRole("button", { name: "Turları hesapla" }));

    const preview = await screen.findByTestId("tour-preview");
    expect(preview).toHaveTextContent("Araç 1");
    expect(preview).toHaveTextContent("2 durak");
    expect(preview).toHaveTextContent("245.6 km");
    // önizleme haritaya da yazıldı
    expect(store.getState().mapWorkspace.toursPreview?.tours).toHaveLength(1);

    // sevkiyata çevir: canlı liste MSW'den demoShipment ile döner
    server.use(
      http.get("/api/v1/shipments/active", () => HttpResponse.json([demoShipment])),
    );
    await user.click(screen.getByRole("button", { name: /Sevkiyatı başlat/ }));

    const fleet = await screen.findByTestId("live-fleet");
    expect(fleet).toHaveTextContent("Yolda");
    expect(fleet).toHaveTextContent("Sıradaki: Bursa Sanayi");
    expect(fleet).toHaveTextContent("ETA 39 dk");
    expect(fleet).toHaveTextContent("1/2 teslim");
    // önizleme temizlendi
    expect(store.getState().mapWorkspace.toursPreview).toBeNull();
  });

  it("canlı filo yokken yönlendirme metni görünür", async () => {
    renderWithProviders(<LogisticsPanel />);
    expect(
      await screen.findByText(/turları hesaplayın; sevkiyatı başlatınca/),
    ).toBeInTheDocument();
  });

  it("Temizle canlı sevkiyatları siler", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/v1/shipments/active", () => HttpResponse.json([demoShipment])),
    );
    renderWithProviders(<LogisticsPanel />);
    await screen.findByTestId("live-fleet");

    server.use(http.get("/api/v1/shipments/active", () => HttpResponse.json([])));
    await user.click(screen.getByRole("button", { name: /Temizle/ }));
    await waitFor(() =>
      expect(screen.queryByTestId("live-fleet")).not.toBeInTheDocument(),
    );
  });
});
