import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { BuilderTab } from "@/features/layout/BuilderTab";
import { renderWithProviders } from "@/test/testUtils";
import { server } from "@/test/mocks/server";
import { demoWarehouse } from "@/test/mocks/handlers";

function clickGrid(svg: SVGElement, xRatio: number, yRatio: number) {
  // jsdom has no layout: pin a deterministic bounding box on the grid.
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500,
    toJSON: () => ({}),
  } as DOMRect);
  fireEvent.click(svg, { clientX: 800 * xRatio, clientY: 500 * yRatio });
}

describe("BuilderTab", () => {
  it("places racks on grid clicks and previews generated bin counts", async () => {
    renderWithProviders(<BuilderTab warehouse={demoWarehouse} />);
    const grid = (await screen.findByTestId("builder-grid")) as unknown as SVGElement;

    clickGrid(grid, 0.1, 0.1);
    clickGrid(grid, 0.1, 0.6);

    expect(screen.getAllByTestId("draft-rack")).toHaveLength(2);
    // default template: 3 shelves × 4 bins → 12 per rack
    expect(screen.getByTestId("preview-racks")).toHaveTextContent("2");
    expect(screen.getByTestId("preview-bins")).toHaveTextContent("24");
  });

  it("rejects overlapping placements", async () => {
    renderWithProviders(<BuilderTab warehouse={demoWarehouse} />);
    const grid = (await screen.findByTestId("builder-grid")) as unknown as SVGElement;

    clickGrid(grid, 0.2, 0.2);
    clickGrid(grid, 0.2, 0.2); // same spot → overlap

    expect(screen.getAllByTestId("draft-rack")).toHaveLength(1);
    expect(await screen.findByText("Raflar üst üste binemez.")).toBeInTheDocument();
  });

  it("submits the placements to the generate endpoint", async () => {
    const user = userEvent.setup();
    let captured: { cell_size: number; racks: unknown[] } | null = null;
    server.use(
      http.post("/api/v1/warehouses/:id/layout/generate", async ({ request }) => {
        captured = (await request.json()) as typeof captured;
        return HttpResponse.json(
          {
            zone_id: 1, zone_code: "Z1", created_aisles: 1, created_racks: 1,
            created_shelves: 3, created_bins: 12, sample_codes: ["Z1-A1-R1-S1-B1"],
          },
          { status: 201 },
        );
      }),
    );

    renderWithProviders(<BuilderTab warehouse={demoWarehouse} />);
    const grid = (await screen.findByTestId("builder-grid")) as unknown as SVGElement;
    clickGrid(grid, 0.1, 0.1);

    await user.click(screen.getByRole("button", { name: "Yerleşimi üret" }));

    await waitFor(() => expect(captured).not.toBeNull());
    expect(captured!.cell_size).toBe(0.5);
    expect(captured!.racks).toHaveLength(1);
    expect(captured!.racks[0]).toMatchObject({
      w_cells: 8,
      d_cells: 2,
      shelf_count: 3,
      bins_per_shelf: 4,
    });
    expect(await screen.findByText(/Yerleşim üretildi/)).toBeInTheDocument();
  });
});
