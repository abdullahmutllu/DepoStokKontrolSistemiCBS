/** Warehouse-local (metre) ↔ WGS84 georeferans köprüsü.
 *
 * Depo içi her şey (raf/göz/rota/konum) origin'e göre METRE cinsinden yaşar
 * (pos_x ∈ [0, local_width], pos_y ∈ [0, local_depth]; y ekranda aşağı = grid-güney).
 * Bu modül o yerel çerçeveyi haritanın lng/lat düzlemine ve tersine taşır —
 * indoor katmanlar, wayfinding rotaları ve RTLS blue-dot'un tamamı buna dayanır.
 *
 * Saf matematik (equirectangular yaklaşımı + bearing rotasyonu); harita nesnesi
 * yok, tam birim-testli. Bina ölçeğinde (~yüzlerce metre) düzlem yaklaşımı
 * yeterince doğru ve binlerce göz için turf çağrılarından çok daha hızlı. */

import type { LatLng } from "@/types";

const M_PER_DEG_LAT = 111_320;

export interface GeoRefInput {
  location: LatLng; // yerel çerçevenin MERKEZİ (warehouse.location)
  local_width: number; // metre (x ekseni)
  local_depth: number; // metre (y ekseni)
  bearing_deg?: number | null; // grid-kuzeyin gerçek kuzeyden saat yönü sapması
}

export interface GeoRef {
  /** Yerel metre (x,y) → [lng, lat]. */
  toLngLat: (x: number, y: number) => [number, number];
  /** [lng, lat] → yerel metre [x, y]. */
  toLocal: (lng: number, lat: number) => [number, number];
  bearingDeg: number;
}

export function makeGeoRef(w: GeoRefInput): GeoRef {
  const { lat: oLat, lng: oLng } = w.location;
  const halfW = w.local_width / 2;
  const halfD = w.local_depth / 2;
  const bearingDeg = w.bearing_deg ?? 0;
  const theta = (bearingDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const mPerDegLng = M_PER_DEG_LAT * Math.cos((oLat * Math.PI) / 180) || 1e-9;

  const toLngLat = (x: number, y: number): [number, number] => {
    // Merkez çerçeveye taşı; y aşağı (güney) olduğundan kuzey = -(y - halfD).
    const ex = x - halfW;
    const ny = -(y - halfD);
    // Grid θ kadar saat yönünde döndürülmüş; gerçek doğu/kuzey bileşenleri:
    const te = ex * cos + ny * sin;
    const tn = -ex * sin + ny * cos;
    return [oLng + te / mPerDegLng, oLat + tn / M_PER_DEG_LAT];
  };

  const toLocal = (lng: number, lat: number): [number, number] => {
    const te = (lng - oLng) * mPerDegLng;
    const tn = (lat - oLat) * M_PER_DEG_LAT;
    // Ters rotasyon (R^T):
    const ex = te * cos - tn * sin;
    const ny = te * sin + tn * cos;
    return [ex + halfW, -ny + halfD];
  };

  return { toLngLat, toLocal, bearingDeg };
}

/** Yerel eksen-hizalı dikdörtgeni (köşe pos_x/pos_y, dim_w × dim_d) kapalı bir
 * lng/lat halkasına projekte eder. rotationDeg verilirse dikdörtgen kendi
 * merkezinde döndürülür (raf yönü). indoorLayers ve minimap bunu kullanır. */
export function localRectToRing(
  ref: GeoRef,
  x: number,
  y: number,
  w: number,
  d: number,
  rotationDeg = 0,
): [number, number][] {
  const cx = x + w / 2;
  const cy = y + d / 2;
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  // Köşeler merkez etrafında (yerel çerçevede) döndürülür, sonra projekte edilir.
  const corners: [number, number][] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  const ring = corners.map(([dx, dy]) => {
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;
    return ref.toLngLat(rx, ry);
  });
  ring.push(ring[0]); // halkayı kapat
  return ring;
}

/** Depo footprint'inin köşe halkası (yön dahil) — haritada bina dış hattı. */
export function warehouseFootprintRing(w: GeoRefInput): [number, number][] {
  const ref = makeGeoRef(w);
  return localRectToRing(ref, 0, 0, w.local_width, w.local_depth);
}
