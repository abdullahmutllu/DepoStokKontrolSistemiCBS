import { describe, expect, it } from "vitest";
import { buildIndoorData, emptyIndoorData, indoorBounds } from "@/features/map/indoorLayers";
import type { Bin3D, Layout3D, StorageLocation } from "@/types";

function rack(id: number, x: number, y: number, level_id: number, extra: Partial<StorageLocation> = {}): StorageLocation {
  return {
    id, warehouse_id: 1, parent_id: null, level_id, type: "rack", code: `R${id}`, label: null,
    pos_x: x, pos_y: y, pos_z: 0, dim_w: 4, dim_d: 1, dim_h: 4.5, rotation: 0, capacity: null,
    meta: null, ...extra,
  };
}

function bin(id: number, x: number, y: number, qty: number, cap: number | null, level_id: number): Bin3D {
  return {
    id, code: `B${id}`, level_id, pos_x: x, pos_y: y, pos_z: 0, dim_w: 1, dim_d: 1, dim_h: 1,
    rotation: 0, capacity: cap, quantity: qty,
  };
}

const LAYOUT: Layout3D = {
  warehouse_id: 1,
  local_width: 100,
  local_depth: 80,
  bearing_deg: 0,
  location: { lat: 39.93, lng: 32.85 },
  levels: [
    { id: 10, ordinal: 0, name: "Zemin", base_elevation_m: 0 },
    { id: 11, ordinal: 1, name: "Asma Kat", base_elevation_m: 5 },
  ],
  zones: [rack(1, 5, 5, 10, { type: "zone", code: "Z1", dim_w: 40, dim_d: 30 })],
  aisles: [],
  racks: [rack(2, 10, 10, 10, { meta: { color: "#5e8bff" } }), rack(3, 10, 40, 11)],
  shelves: [],
  bins: [bin(101, 10, 10, 0, 100, 10), bin(102, 14, 10, 90, 100, 10), bin(103, 10, 40, 50, 100, 11)],
};

describe("indoorLayers", () => {
  it("konumu olmayan layout'ta boş veri döner", () => {
    expect(buildIndoorData({ ...LAYOUT, location: null }).bins.features).toHaveLength(0);
    expect(emptyIndoorData().racks.features).toHaveLength(0);
  });

  it("zone/rack/bin ve kat başına footprint üretir", () => {
    const d = buildIndoorData(LAYOUT);
    expect(d.zones.features).toHaveLength(1);
    expect(d.racks.features).toHaveLength(2);
    expect(d.bins.features).toHaveLength(3);
    expect(d.footprint.features).toHaveLength(2); // kat sayısı
  });

  it("her feature kat sırasını (level_ord) taşır — kat filtresi için", () => {
    const d = buildIndoorData(LAYOUT);
    const binOrds = d.bins.features.map((f) => f.properties!.level_ord);
    expect(binOrds).toEqual([0, 0, 1]); // level_id 10→0, 11→1
    expect(d.racks.features[1].properties!.level_ord).toBe(1);
  });

  it("göz rengi doluluğu yansıtır (boş gri, dolu kırmızı)", () => {
    const d = buildIndoorData(LAYOUT);
    expect(d.bins.features[0].properties!.color).toBe("#3d475c"); // qty 0 → empty
    expect(d.bins.features[1].properties!.color).toBe("#e25c4a"); // %90 → high
  });

  it("rack rengi meta'dan gelir, yoksa varsayılana düşer", () => {
    const d = buildIndoorData(LAYOUT);
    expect(d.racks.features[0].properties!.color).toBe("#5e8bff"); // meta
    expect(d.racks.features[1].properties!.color).toBe("#4b5772"); // varsayılan
  });

  it("indoorBounds merkezi saran bir sınır kutusu üretir", () => {
    const b = indoorBounds(LAYOUT)!;
    expect(b[0][0]).toBeLessThan(32.85);
    expect(b[1][0]).toBeGreaterThan(32.85);
    expect(b[0][1]).toBeLessThan(39.93);
    expect(b[1][1]).toBeGreaterThan(39.93);
  });
});
