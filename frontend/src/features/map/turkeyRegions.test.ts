import { describe, expect, it } from "vitest";
import { booleanPointInPolygon, point } from "@turf/turf";
import { TURKEY_REGIONS } from "@/features/map/turkeyRegions";
import { polygonAreaM2, ringToFeature } from "@/features/map/geometry";

const CITY_IN_REGION: Record<string, [number, number]> = {
  marmara: [41.01, 28.98], // İstanbul
  ege: [38.42, 27.14], // İzmir
  akdeniz: [36.9, 30.7], // Antalya
  "ic-anadolu": [39.93, 32.85], // Ankara
  karadeniz: [41.0, 39.72], // Trabzon
  "dogu-anadolu": [39.9, 41.27], // Erzurum
  "guneydogu-anadolu": [37.91, 40.24], // Diyarbakır
};

describe("TURKEY_REGIONS presets", () => {
  it("defines 7 regions with valid rings", () => {
    expect(TURKEY_REGIONS).toHaveLength(7);
    for (const region of TURKEY_REGIONS) {
      expect(region.ring.length).toBeGreaterThanOrEqual(3);
      // Plausible area: every Turkish region is between 30k and 300k km².
      const km2 = polygonAreaM2(ringToFeature(region.ring)) / 1e6;
      expect(km2, `${region.name} alanı`).toBeGreaterThan(30_000);
      expect(km2, `${region.name} alanı`).toBeLessThan(300_000);
    }
  });

  it("contains its landmark city in each region", () => {
    for (const region of TURKEY_REGIONS) {
      const [lat, lng] = CITY_IN_REGION[region.id];
      const inside = booleanPointInPolygon(point([lng, lat]), ringToFeature(region.ring));
      expect(inside, `${region.name} kendi şehir noktasını içermeli`).toBe(true);
    }
  });

  it("keeps landmark cities out of neighboring regions", () => {
    const ankara = point([32.85, 39.93]);
    const izmir = point([27.14, 38.42]);
    const marmara = TURKEY_REGIONS.find((r) => r.id === "marmara")!;
    const icAnadolu = TURKEY_REGIONS.find((r) => r.id === "ic-anadolu")!;
    expect(booleanPointInPolygon(ankara, ringToFeature(marmara.ring))).toBe(false);
    expect(booleanPointInPolygon(izmir, ringToFeature(icAnadolu.ring))).toBe(false);
  });
});
