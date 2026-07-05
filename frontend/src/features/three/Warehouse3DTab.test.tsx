import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Warehouse3DTab } from "@/features/three/Warehouse3DTab";
import { DetailPanel } from "@/features/three/DetailPanel";
import { binSelected } from "@/features/three/selectionSlice";
import { renderWithProviders } from "@/test/testUtils";
import { server } from "@/test/mocks/server";

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

  it("renk modu anahtarı lejantı ABC sınıflarına çevirir", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Warehouse3DTab warehouseId={3} />);
    await screen.findByTestId("r3f-canvas");

    await user.click(screen.getByRole("radio", { name: "Hareket (ABC)" }));
    expect(screen.getByText("A · yoğun")).toBeInTheDocument();
    expect(screen.getByText("Hareketsiz")).toBeInTheDocument();
    expect(screen.queryByText("%60 altı")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Doluluk" }));
    expect(screen.getByText("%60 altı")).toBeInTheDocument();
  });

  it("görünüm modu anahtarı Gerçekçi moda geçer", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Warehouse3DTab warehouseId={3} />);
    await screen.findByTestId("r3f-canvas");

    const realistic = screen.getByRole("radio", { name: "Gerçekçi" });
    await user.click(realistic);
    expect(realistic).toHaveAttribute("aria-checked", "true");
  });

  it("yürüyüş modu: düğme → kilit overlay'i görünür", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Warehouse3DTab warehouseId={3} />);
    await screen.findByTestId("r3f-canvas");

    await user.click(screen.getByRole("button", { name: /Yürüyüş/ }));
    expect(await screen.findByText(/Yürüyüş moduna girmek için tıklayın/)).toBeInTheDocument();
    expect(screen.getByText(/WASD/)).toBeInTheDocument();
  });

  it("yerleştirme önerisi: gözler vurgulanır ve çipler gelir", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/api/v1/ai/slotting", () =>
        HttpResponse.json({
          ai_available: true,
          suggestions: [
            { location_id: 102, code: "Z1-A1-R1-S1-B2", score: 0.9, reason: "Kapıya en yakın boş göz" },
          ],
          explanation: "Kural tabanlı",
        }),
      ),
      http.get("/api/v1/products", () =>
        HttpResponse.json({
          items: [
            { id: 7, sku: "RLM-6204", name: "Rulman", description: null, unit: "adet", barcode: null, dim_w: null, dim_d: null, dim_h: null, min_stock_threshold: 0, image_url: null, created_at: "2026-01-01T00:00:00Z" },
          ],
          total: 1,
          page: 1,
          page_size: 100,
        }),
      ),
    );
    const { store } = renderWithProviders(<Warehouse3DTab warehouseId={3} />);
    await screen.findByTestId("r3f-canvas");

    await user.click(await screen.findByRole("button", { name: "Göz öner" }));
    expect(await screen.findByRole("button", { name: /Z1-A1-R1-S1-B2/ })).toBeInTheDocument();
    expect(store.getState().selection.highlightedIds).toEqual([102]);
  });

  it("toplama rotası: rastgele gözler → 3 politika çipi + kazanan + kapat", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Warehouse3DTab warehouseId={3} />);
    await screen.findByTestId("r3f-canvas");

    await user.click(screen.getByRole("button", { name: /Rastgele 8 göz/ }));

    // Üç politika çipi metre değerleriyle gelir; en iyi ★ ile işaretlenir.
    const optimize = await screen.findByRole("button", { name: /Optimize · 31,5 m/ });
    expect(optimize).toHaveTextContent("★");
    expect(optimize).toHaveAttribute("aria-pressed", "true"); // kazanan otomatik seçilir
    expect(screen.getByRole("button", { name: /S-shape · 42,5 m/ })).toBeInTheDocument();
    const lg = screen.getByRole("button", { name: /Largest-gap · 38 m/ });
    expect(lg).toHaveTextContent("−%11"); // s-shape'e göre kazanç
    expect(screen.getByText(/Ratliff–Rosenthal \(1983\)/)).toBeInTheDocument();

    // Politika değiştirilebilir.
    await user.click(lg);
    expect(lg).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: /Kapat/ }));
    expect(screen.getByRole("button", { name: /Rastgele 8 göz/ })).toBeInTheDocument();
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

  it("istek başarısız olursa sonsuz iskelet yerine hata + tekrar dene gösterir", async () => {
    server.use(
      http.get("/api/v1/locations/:id", () =>
        HttpResponse.json(
          { error: { code: "INTERNAL", message: "Sunucuya ulaşılamadı", details: null } },
          { status: 500 },
        ),
      ),
    );
    const { store } = renderWithProviders(<DetailPanel />);
    store.dispatch(binSelected(101));

    expect(await screen.findByText(/Sunucuya ulaşılamadı/)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Tekrar dene" });

    // Sunucu düzelince "Tekrar dene" paneli doldurur.
    server.resetHandlers();
    retry.click();
    expect(await screen.findByText("RLM-6204")).toBeInTheDocument();
  });
});
