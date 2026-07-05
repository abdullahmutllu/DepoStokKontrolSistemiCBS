/** Teslimat turları + canlı araç takibi harita katmanları (saf kurucular +
 * tek imperatif sync). Ağ katmanlarıyla aynı desen: kaynaklar upsert edilir,
 * görünürlük toggle'lanır, hepsi Terra Draw'un altında kalır. */

import type { Map as MlMap } from "maplibre-gl";
import type { Shipment, Tour } from "@/types";

export const TOUR_COLORS = [
  "#5e8bff",
  "#3fb970",
  "#e0a93e",
  "#c957d0",
  "#4dc3d6",
  "#e25c4a",
  "#8bc34a",
  "#ff8a5c",
];

export const tourColor = (index: number): string => TOUR_COLORS[index % TOUR_COLORS.length];

interface RouteLike {
  points: { lat: number; lng: number }[];
  colorIndex: number;
  label: string;
}

export function tourRoutes(tours: Tour[], depot: { lat: number; lng: number }): RouteLike[] {
  return tours.map((tour, i) => ({
    points: [depot, ...tour.stops.map((s) => s.location), depot],
    colorIndex: i,
    label: tour.vehicle_name,
  }));
}

export function shipmentRoutes(shipments: Shipment[]): RouteLike[] {
  return shipments.map((s, i) => ({ points: s.route, colorIndex: i, label: s.vehicle_name }));
}

export function routesFC(routes: RouteLike[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.map((r) => ({
      type: "Feature",
      properties: { color: tourColor(r.colorIndex), label: r.label },
      geometry: {
        type: "LineString",
        coordinates: r.points.map((p) => [p.lng, p.lat]),
      },
    })),
  };
}

export function routeStopsFC(routes: RouteLike[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routes.flatMap((r) =>
      // ilk/son nokta depot — durak değil
      r.points.slice(1, -1).map((p, stopIdx) => ({
        type: "Feature" as const,
        properties: { color: tourColor(r.colorIndex), order: stopIdx + 1 },
        geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
      })),
    ),
  };
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function upsertSource(map: MlMap, id: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(id) as { setData?: (d: unknown) => void } | undefined;
  if (source?.setData) source.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

/** Tur çizgileri + durak noktaları. `routes` boşsa katmanlar gizlenir. */
export function syncTrackingLayers(
  map: MlMap,
  routes: RouteLike[],
  beforeId?: string,
): void {
  upsertSource(map, "trk-routes", routes.length ? routesFC(routes) : EMPTY);
  upsertSource(map, "trk-stops", routes.length ? routeStopsFC(routes) : EMPTY);

  const layers: { id: string; def: object }[] = [
    {
      id: "trk-route-casing",
      def: {
        type: "line",
        source: "trk-routes",
        paint: { "line-color": "#0f1522", "line-width": 5, "line-opacity": 0.55 },
      },
    },
    {
      id: "trk-route-line",
      def: {
        type: "line",
        source: "trk-routes",
        paint: { "line-color": ["get", "color"], "line-width": 2.6, "line-opacity": 0.92 },
      },
    },
    {
      id: "trk-stop-circle",
      def: {
        type: "circle",
        source: "trk-stops",
        paint: {
          "circle-radius": 4.5,
          "circle-color": ["get", "color"],
          "circle-stroke-color": "#0f1522",
          "circle-stroke-width": 1.4,
        },
      },
    },
  ];
  for (const { id, def } of layers) {
    if (!map.getLayer(id)) map.addLayer({ id, ...(def as object) } as never, beforeId);
    map.setLayoutProperty(id, "visibility", routes.length ? "visible" : "none");
  }
}

/* ── Canlı araç DOM marker'ı ─────────────────────────────────────────────── */

export function vehicleMarkerHtml(shipment: Shipment, colorIndex: number): string {
  const color = tourColor(colorIndex);
  const { heading_deg, progress_percent, status } = shipment.live;
  const done = status === "completed";
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px;pointer-events:none">
      <div style="padding:1px 7px;border-radius:999px;background:#0f1522e0;border:1px solid ${color};
                  color:#e6eaf4;font:600 10px 'IBM Plex Mono',monospace;white-space:nowrap">
        ${shipment.vehicle_name} · %${Math.round(progress_percent)}
      </div>
      <div style="width:26px;height:26px;border-radius:999px;background:${color};
                  border:2.5px solid #0f1522;display:grid;place-items:center;
                  box-shadow:0 2px 10px #000a;${done ? "opacity:.55" : ""}">
        <svg width="13" height="13" viewBox="0 0 24 24"
             style="transform:rotate(${heading_deg}deg);transition:transform 1.2s linear">
          <path d="M12 2 L19 21 L12 16.5 L5 21 Z" fill="#0f1522"/>
        </svg>
      </div>
    </div>`;
}
