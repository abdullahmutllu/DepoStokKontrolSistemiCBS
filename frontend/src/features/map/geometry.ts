/** Pure turf-based geometry helpers — no map objects, fully unit-testable. */

import {
  area,
  booleanPointInPolygon,
  length,
  lineString,
  point,
  polygon,
} from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import type { LatLng, Warehouse } from "@/types";
import { OCCUPANCY_COLORS, occupancyBucket } from "@/features/three/occupancy";

export function ringToFeature(ring: LatLng[]): Feature<Polygon> {
  const coords = ring.map((p) => [p.lng, p.lat]);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
  return polygon([coords]);
}

export function featureToRing(feature: Feature<Polygon>): LatLng[] {
  const coords = feature.geometry.coordinates[0] ?? [];
  // Drop the closing vertex; the backend re-closes.
  const open = coords.length > 1 ? coords.slice(0, -1) : coords;
  return open.map(([lng, lat]) => ({ lat, lng }));
}

export function polygonAreaM2(feature: Feature<Polygon>): number {
  return area(feature);
}

export function lineLengthM(coords: [number, number][]): number {
  if (coords.length < 2) return 0;
  return length(lineString(coords), { units: "kilometers" }) * 1000;
}

/** Instant client-side pre-highlight while the server analysis runs. */
export function warehousesInPolygon(
  warehouses: Warehouse[],
  feature: Feature<Polygon>,
): Warehouse[] {
  return warehouses.filter((wh) =>
    booleanPointInPolygon(point([wh.location.lng, wh.location.lat]), feature),
  );
}

const TR = "tr-TR";

export function formatArea(m2: number): string {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toLocaleString(TR, { maximumFractionDigits: 2 })} km²`;
  if (m2 >= 10_000) return `${(m2 / 10_000).toLocaleString(TR, { maximumFractionDigits: 2 })} ha`;
  return `${m2.toLocaleString(TR, { maximumFractionDigits: 0 })} m²`;
}

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toLocaleString(TR, { maximumFractionDigits: 2 })} km`;
  return `${m.toLocaleString(TR, { maximumFractionDigits: 0 })} m`;
}

export interface MarkerStyle {
  color: string;
  sizePx: number;
}

/** Marker encodes two data channels: occupancy color + stock-scaled size. */
export function markerStyle(warehouse: Warehouse): MarkerStyle {
  const pct = warehouse.occupancy_percent;
  const bucket =
    pct == null || warehouse.bin_count === 0
      ? "empty"
      : occupancyBucket(Math.round(pct), 100);
  const qty = warehouse.total_quantity ?? 0;
  const sizePx = Math.min(44, Math.max(22, Math.round(16 + Math.sqrt(qty) * 0.45)));
  return { color: OCCUPANCY_COLORS[bucket], sizePx };
}
