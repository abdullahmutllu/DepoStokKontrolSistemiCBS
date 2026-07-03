import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { WarehouseFormDialog } from "@/features/warehouses/WarehouseFormDialog";
import { renderWithProviders } from "@/test/testUtils";
import { server } from "@/test/mocks/server";

interface MockMapInstance {
  fire: (event: string, payload: unknown) => void;
}

describe("WarehouseFormDialog", () => {
  it("submits name, dimensions and the map-click location", async () => {
    const user = userEvent.setup();
    let captured: Record<string, unknown> | null = null;
    server.use(
      http.post("/api/v1/warehouses", async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { ...captured, id: 42, footprint: null, created_at: "2026-01-01T00:00:00Z" },
          { status: 201 },
        );
      }),
    );

    renderWithProviders(<WarehouseFormDialog open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText("Depo adı"), "Test Depo");

    // The mocked maplibre Map exposes registered handlers; fire a map click
    // exactly as the user placing the pin would.
    const mockMap = (window as unknown as Record<string, unknown>).__mockMap as MockMapInstance;
    expect(mockMap).toBeTruthy();
    mockMap.fire("click", { lngLat: { lat: 39.92, lng: 32.85 } });

    await screen.findByText(/39\.92000/);
    await user.click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!).toMatchObject({
      name: "Test Depo",
      local_width: 40,
      local_depth: 25,
      location: { lat: 39.92, lng: 32.85 },
    });
  });

  it("refuses to submit without a map location", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WarehouseFormDialog open onOpenChange={() => {}} />);
    await user.type(screen.getByLabelText("Depo adı"), "Konumsuz Depo");
    await user.click(screen.getByRole("button", { name: "Kaydet" }));
    // sonner toast with directive copy
    expect(
      await screen.findByText("Haritaya tıklayarak depo konumunu seçin."),
    ).toBeInTheDocument();
  });
});
