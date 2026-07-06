/** İç mekân (indoor) harita katmanları: georef ile yerel metre → GeoJSON
 * projeksiyonu (saf, birim-testli) + tek imperative sync.
 *
 * Mevcut 3B iç mekân geometrisini (Layout3D: zone/rack/bin) haritanın lng/lat
 * düzlemine taşır. Katmanlar Terra Draw'un ALTINA eklenir (beforeId), basemap
 * değişimine dayanıklıdır (visibility ile), aktif kata göre setFilter'la süzülür.
 * IMDF-lite: footprint≈venue/level dış hattı, zone/rack/bin≈unit. Track A.
 */

import type { Map as MlMap } from "maplibre-gl";
import type { Layout3D } from "@/types";
import {
  localRectToRing,
  makeGeoRef,
  warehouseFootprintRing,
  type GeoRef,
} from "@/features/map/georef";
import { occupancyColor } from "@/features/three/occupancy";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/* ── pure builders ───────────────────────────────────────────────────────── */

function levelOrdMap(layout: Layout3D): Map<number, number> {
  const m = new Map<number, number>();
  for (const lv of layout.levels ?? []) m.set(lv.id, lv.ordinal);
  return m;
}

const ordOf = (levelId: number | null | undefined, ords: Map<number, number>): number =>
  levelId == null ? 0 : ords.get(levelId) ?? 0;

function rectFeature(
  ref: GeoRef,
  loc: { pos_x: number; pos_y: number; dim_w: number; dim_d: number; rotation?: number },
  props: Record<string, unknown>,
): GeoJSON.Feature {
  const ring = localRectToRing(ref, loc.pos_x, loc.pos_y, loc.dim_w, loc.dim_d, loc.rotation ?? 0);
  return { type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } };
}

export interface IndoorData {
  footprint: GeoJSON.FeatureCollection;
  zones: GeoJSON.FeatureCollection;
  racks: GeoJSON.FeatureCollection;
  bins: GeoJSON.FeatureCollection;
}

export function emptyIndoorData(): IndoorData {
  return { footprint: EMPTY, zones: EMPTY, racks: EMPTY, bins: EMPTY };
}

/** Layout3D (georeferanslı) → kat-etiketli GeoJSON katmanları. */
export function buildIndoorData(layout: Layout3D): IndoorData {
  if (!layout.location) return emptyIndoorData();
  const geoInput = {
    location: layout.location,
    local_width: layout.local_width,
    local_depth: layout.local_depth,
    bearing_deg: layout.bearing_deg,
  };
  const ref = makeGeoRef(geoInput);
  const ords = levelOrdMap(layout);
  const levels = layout.levels?.length
    ? layout.levels
    : [{ id: 0, ordinal: 0, name: "Zemin", base_elevation_m: 0 }];

  const footprintRing = warehouseFootprintRing(geoInput);
  const footprint: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: levels.map((lv) => ({
      type: "Feature",
      properties: { level_ord: lv.ordinal, name: lv.name },
      geometry: { type: "Polygon", coordinates: [footprintRing] },
    })),
  };

  const zones: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: layout.zones.map((z) =>
      rectFeature(ref, z, { level_ord: ordOf(z.level_id, ords), code: z.code }),
    ),
  };

  const racks: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: layout.racks.map((r) =>
      rectFeature(ref, r, {
        level_ord: ordOf(r.level_id, ords),
        code: r.code,
        color: (r.meta?.color as string | undefined) ?? "#4b5772",
      }),
    ),
  };

  const bins: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: layout.bins.map((b) =>
      rectFeature(ref, b, {
        level_ord: ordOf(b.level_id, ords),
        code: b.code,
        color: occupancyColor(b.quantity, b.capacity),
        quantity: b.quantity,
      }),
    ),
  };

  return { footprint, zones, racks, bins };
}

/** İç mekân footprint'inin coğrafi sınır kutusu — 'depoya gir' fitBounds için. */
export function indoorBounds(layout: Layout3D): [[number, number], [number, number]] | null {
  if (!layout.location) return null;
  const ring = warehouseFootprintRing({
    location: layout.location,
    local_width: layout.local_width,
    local_depth: layout.local_depth,
    bearing_deg: layout.bearing_deg,
  });
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

/* ── imperative map sync ─────────────────────────────────────────────────── */

function upsertSource(map: MlMap, id: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(id) as { setData?: (d: unknown) => void } | undefined;
  if (source?.setData) source.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

/** Sources/layers ilk çağrıda kurulur, sonra yalnız veri + kat filtresi +
 * görünürlük güncellenir. `activeLevel` null ise iç mekân gizlenir. */
export function syncIndoorLayers(
  map: MlMap,
  data: IndoorData,
  activeLevel: number | null,
  beforeId?: string,
): void {
  upsertSource(map, "indoor-footprint", data.footprint);
  upsertSource(map, "indoor-zones", data.zones);
  upsertSource(map, "indoor-racks", data.racks);
  upsertSource(map, "indoor-bins", data.bins);

  const visible = activeLevel != null;
  const layers: { id: string; def: object }[] = [
    {
      id: "indoor-footprint-fill",
      def: {
        type: "fill",
        source: "indoor-footprint",
        paint: { "fill-color": "#0f1522", "fill-opacity": 0.72 },
      },
    },
    {
      id: "indoor-footprint-line",
      def: {
        type: "line",
        source: "indoor-footprint",
        paint: { "line-color": "#5c6682", "line-width": 2 },
      },
    },
    {
      id: "indoor-zones-fill",
      def: {
        type: "fill",
        source: "indoor-zones",
        paint: { "fill-color": "#5e8bff", "fill-opacity": 0.07 },
      },
    },
    {
      id: "indoor-zones-line",
      def: {
        type: "line",
        source: "indoor-zones",
        paint: { "line-color": "#5e8bff", "line-opacity": 0.35, "line-width": 1, "line-dasharray": [2, 2] },
      },
    },
    {
      id: "indoor-racks-fill",
      def: {
        type: "fill",
        source: "indoor-racks",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.5 },
      },
    },
    {
      id: "indoor-bins-fill",
      def: {
        type: "fill",
        source: "indoor-bins",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.9 },
      },
    },
    {
      id: "indoor-bins-line",
      def: {
        type: "line",
        source: "indoor-bins",
        paint: { "line-color": "#0f1522", "line-opacity": 0.5, "line-width": 0.4 },
      },
    },
  ];

  const filter = ["==", ["get", "level_ord"], activeLevel ?? 0] as unknown;
  for (const { id, def } of layers) {
    if (!map.getLayer(id)) map.addLayer({ id, ...(def as object) } as never, beforeId);
    map.setFilter(id, filter as never);
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}
