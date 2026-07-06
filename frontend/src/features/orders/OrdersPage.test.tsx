import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { OrdersPage } from "@/features/orders/OrdersPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { BarcodeScanner } from "@/components/shared/BarcodeScanner";
import { renderWithProviders } from "@/test/testUtils";
import { server } from "@/test/mocks/server";
import type { CustomerOrder, WavePick } from "@/types";

const order = (id: number, status: CustomerOrder["status"]): CustomerOrder => ({
  id,
  code: `SIP-${String(id).padStart(4, "0")}`,
  warehouse_id: 3,
  customer_name: id === 1 ? "Aslan Market" : "Kaya Oto",
  status,
  created_at: "2026-07-05T09:00:00Z",
  lines: [{ product_id: 7, sku: "RLM-6204", product_name: "Rulman", quantity: 5 }],
});

const waveResult: WavePick = {
  order_ids: [1, 2],
  warehouse_id: 3,
  lines: [
    {
      product_id: 7, sku: "RLM-6204", product_name: "Rulman 6204 2RS",
      total_quantity: 8, location_id: 101, location_code: "Z1-A1-R1-S1-B1",
    },
  ],
  route: {
    warehouse_id: 3,
    pick_count: 2,
    best_policy: "optimized",
    routes: [
      { policy: "optimized", total_m: 31.5, stops: [], path: [] },
      { policy: "s_shape", total_m: 42.5, stops: [], path: [] },
      { policy: "largest_gap", total_m: 38, stops: [], path: [] },
    ],
  },
};

describe("OrdersPage", () => {
  it("siparişleri listeler, dalga toplar ve yazdırılabilir liste üretir", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/v1/orders", () => HttpResponse.json([order(1, "open"), order(2, "open")])),
      http.post("/api/v1/orders/wave-pick", () => HttpResponse.json(waveResult)),
    );
    renderWithProviders(<OrdersPage />);

    expect(await screen.findByText("SIP-0001")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "SIP-0001 seç" }));
    await user.click(screen.getByRole("checkbox", { name: "SIP-0002 seç" }));
    await user.click(screen.getByRole("button", { name: /Dalga topla \(2\)/ }));

    const wave = await screen.findByTestId("wave-result");
    expect(wave).toHaveTextContent("RLM-6204");
    expect(wave).toHaveTextContent("8"); // 5+3 birleşik miktar örneği
    expect(wave).toHaveTextContent("Z1-A1-R1-S1-B1");
    expect(wave).toHaveTextContent("Optimize");
    expect(wave).toHaveTextContent("31.5 m");
    expect(screen.getByRole("button", { name: /Yazdır/ })).toBeInTheDocument();
  });

  it("dalgaya alınmış sipariş 'Toplandı' ile kapatılır", async () => {
    const user = userEvent.setup();
    let picked = false;
    server.use(
      http.get("/api/v1/orders", () =>
        HttpResponse.json([order(1, picked ? "picked" : "waved")]),
      ),
      http.post("/api/v1/orders/1/picked", () => {
        picked = true;
        return HttpResponse.json(order(1, "picked"));
      }),
    );
    renderWithProviders(<OrdersPage />);
    expect(await screen.findByText("Dalgada")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Toplandı/ }));
    await waitFor(() => expect(screen.getByText("Toplandı")).toBeInTheDocument());
  });
});

describe("DashboardPage KPI şeridi", () => {
  it("KPI değerlerini gösterir", async () => {
    renderWithProviders(<DashboardPage />);
    const strip = await screen.findByTestId("kpi-strip");
    expect(strip).toHaveTextContent("0.42"); // devir hızı
    expect(strip).toHaveTextContent("960"); // çıkış
    expect(strip).toHaveTextContent("Aktif sevkiyat");
  });
});

describe("BarcodeScanner", () => {
  it("BarcodeDetector yoksa dürüst fallback mesajı gösterir", () => {
    renderWithProviders(<BarcodeScanner onDetect={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/BarcodeDetector API/)).toBeInTheDocument();
    expect(screen.getByText(/Chrome veya Edge/)).toBeInTheDocument();
  });
});
