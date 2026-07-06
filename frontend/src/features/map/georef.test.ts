import { describe, expect, it } from "vitest";
import { localRectToRing, makeGeoRef, warehouseFootprintRing } from "@/features/map/georef";

const WH = { location: { lat: 39.93, lng: 32.85 }, local_width: 100, local_depth: 80 };

describe("georef", () => {
  it("depo merkezi yerel çerçevenin ortasına (halfW, halfD) düşer", () => {
    const ref = makeGeoRef(WH);
    const [lng, lat] = ref.toLngLat(50, 40);
    expect(lng).toBeCloseTo(32.85, 9);
    expect(lat).toBeCloseTo(39.93, 9);
  });

  it("bearing 0'da +x doğuya, +y (aşağı) güneye gider", () => {
    const ref = makeGeoRef(WH);
    const [lngE, latE] = ref.toLngLat(60, 40); // +10 m x
    expect(lngE).toBeGreaterThan(32.85); // doğu → lng artar
    expect(latE).toBeCloseTo(39.93, 9);

    const [lngS, latS] = ref.toLngLat(50, 50); // +10 m y (aşağı)
    expect(latS).toBeLessThan(39.93); // güney → lat azalır
    expect(lngS).toBeCloseTo(32.85, 9);
  });

  it("ileri→geri round-trip metre doğruluğunda korunur", () => {
    const ref = makeGeoRef({ ...WH, bearing_deg: 27 });
    for (const [x, y] of [
      [0, 0],
      [100, 80],
      [12.5, 63.2],
      [77, 4],
    ]) {
      const [lng, lat] = ref.toLngLat(x, y);
      const [bx, by] = ref.toLocal(lng, lat);
      expect(bx).toBeCloseTo(x, 4); // ~0.1 mm
      expect(by).toBeCloseTo(y, 4);
    }
  });

  it("bearing depoyu döndürür: 90°'de grid-kuzey gerçek doğuya bakar", () => {
    const ref = makeGeoRef({ ...WH, bearing_deg: 90 });
    // Merkezin grid-kuzeyindeki nokta (y küçük) gerçek doğuya (lng artar) düşer.
    const [lng, lat] = ref.toLngLat(50, 30); // merkezden 10 m grid-kuzey
    expect(lng).toBeGreaterThan(32.85);
    expect(lat).toBeCloseTo(39.93, 6);
  });

  it("localRectToRing kapalı 5-nokta halka üretir", () => {
    const ref = makeGeoRef(WH);
    const ring = localRectToRing(ref, 10, 10, 8, 2);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]); // kapalı
  });

  it("warehouseFootprintRing dört köşeyi kapatır ve merkezi doğru sarar", () => {
    const ring = warehouseFootprintRing(WH);
    expect(ring).toHaveLength(5);
    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    // Merkez (32.85, 39.93) footprint sınırları içinde kalmalı.
    expect(Math.min(...lngs)).toBeLessThan(32.85);
    expect(Math.max(...lngs)).toBeGreaterThan(32.85);
    expect(Math.min(...lats)).toBeLessThan(39.93);
    expect(Math.max(...lats)).toBeGreaterThan(39.93);
  });
});
