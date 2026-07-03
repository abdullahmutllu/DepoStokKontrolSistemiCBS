import { describe, expect, it } from "vitest";
import type { Warehouse } from "@/types";
import {
  featureToRing,
  formatArea,
  formatDistance,
  lineLengthM,
  markerStyle,
  polygonAreaM2,
  ringToFeature,
  warehousesInPolygon,
} from "@/features/map/geometry";

// ~1.11 km × ~0.85 km square at 40°N (0.01° per side)
const SQUARE = [
  { lat: 39.915, lng: 32.845 },
  { lat: 39.915, lng: 32.855 },
  { lat: 39.925, lng: 32.855 },
  { lat: 39.925, lng: 32.845 },
];

function wh(id: number, lat: number, lng: number, qty = 0, pct: number | null = null): Warehouse {
  return {
    id,
    name: `W${id}`,
    address: null,
    location: { lat, lng },
    footprint: null,
    local_width: 40,
    local_depth: 25,
    created_at: "2026-01-01T00:00:00Z",
    total_quantity: qty,
    bin_count: pct == null ? 0 : 10,
    occupancy_percent: pct,
  };
}

describe("geometry", () => {
  it("ring↔feature round-trips and auto-closes", () => {
    const feature = ringToFeature(SQUARE);
    const coords = feature.geometry.coordinates[0];
    expect(coords).toHaveLength(5); // closed
    expect(coords[0]).toEqual(coords[4]);
    expect(featureToRing(feature)).toEqual(SQUARE);
  });

  it("computes plausible area for a known ~1km square", () => {
    const m2 = polygonAreaM2(ringToFeature(SQUARE));
    expect(m2).toBeGreaterThan(0.5e6);
    expect(m2).toBeLessThan(2e6);
  });

  it("computes line length in meters", () => {
    // one degree of longitude at equator ≈ 111.32 km
    const meters = lineLengthM([
      [0, 0],
      [1, 0],
    ]);
    expect(meters).toBeGreaterThan(110_000);
    expect(meters).toBeLessThan(112_500);
    expect(lineLengthM([[0, 0]])).toBe(0);
  });

  it("filters warehouses by polygon containment", () => {
    const inside = wh(1, 39.92, 32.85);
    const outside = wh(2, 41.06, 28.79);
    const hits = warehousesInPolygon([inside, outside], ringToFeature(SQUARE));
    expect(hits.map((w) => w.id)).toEqual([1]);
  });

  it("formats areas across unit bands (tr-TR)", () => {
    expect(formatArea(500)).toMatch(/m²$/);
    expect(formatArea(50_000)).toMatch(/ha$/);
    expect(formatArea(2_500_000)).toMatch(/km²$/);
  });

  it("formats distances across unit bands", () => {
    expect(formatDistance(420)).toMatch(/m$/);
    expect(formatDistance(1500)).toMatch(/km$/);
  });

  it("marker size scales with stock and clamps to [22, 44]", () => {
    expect(markerStyle(wh(1, 0, 0, 0, null)).sizePx).toBeGreaterThanOrEqual(22);
    expect(markerStyle(wh(1, 0, 0, 1_000_000, 50)).sizePx).toBeLessThanOrEqual(44);
    const small = markerStyle(wh(1, 0, 0, 10, 10)).sizePx;
    const big = markerStyle(wh(2, 0, 0, 4000, 10)).sizePx;
    expect(big).toBeGreaterThan(small);
  });

  it("marker color follows the occupancy scale", () => {
    expect(markerStyle(wh(1, 0, 0, 100, 90)).color).toBe("#e25c4a");
    expect(markerStyle(wh(1, 0, 0, 100, 70)).color).toBe("#e0a93e");
    expect(markerStyle(wh(1, 0, 0, 100, 20)).color).toBe("#3fb970");
    expect(markerStyle(wh(1, 0, 0, 0, null)).color).toBe("#3d475c");
  });
});
