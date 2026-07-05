/** Network-analysis map layers: pure GeoJSON builders + one imperative sync.
 *
 * All layers are inserted BELOW Terra Draw's layers (via beforeId) so drawn
 * regions stay interactive on top. Basemap switching uses visibility only,
 * so sources/layers added here survive it.
 */

import type { Map as MlMap } from "maplibre-gl";
import type {
  AssignmentLine,
  CenterOfGravity,
  ClosestFacility,
  Coverage,
  DemandPoint,
  FlowArc,
  LatLng,
} from "@/types";
import type { NetworkLayerToggles } from "@/features/map/mapWorkspaceSlice";

/* ── pure GeoJSON builders (unit-tested) ─────────────────────────────────── */

export function demandFC(points: DemandPoint[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((p) => ({
      type: "Feature",
      properties: { id: p.id, name: p.name, weight: p.weight },
      geometry: { type: "Point", coordinates: [p.location.lng, p.location.lat] },
    })),
  };
}

export function assignmentFC(
  lines: AssignmentLine[],
  kind: "current" | "proposed",
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: lines.map((l) => ({
      type: "Feature",
      properties: { weight: l.weight, kind },
      geometry: {
        type: "LineString",
        coordinates: [
          [l.from_location.lng, l.from_location.lat],
          [l.to_location.lng, l.to_location.lat],
        ],
      },
    })),
  };
}

export function proposedSitesFC(cog: CenterOfGravity): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cog.proposed_sites.map((s, i) => ({
      type: "Feature",
      properties: { index: i + 1, weight: s.assigned_weight },
      geometry: { type: "Point", coordinates: [s.location.lng, s.location.lat] },
    })),
  };
}

function ringToPolygon(ring: LatLng[]): GeoJSON.Polygon {
  const coords = ring.map((p) => [p.lng, p.lat]);
  if (coords.length > 0) {
    const [fx, fy] = coords[0];
    const [lx, ly] = coords[coords.length - 1];
    if (fx !== lx || fy !== ly) coords.push([fx, fy]);
  }
  return { type: "Polygon", coordinates: [coords] };
}

export function voronoiFC(cf: ClosestFacility): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: cf.territories.map((t) => ({
      type: "Feature",
      properties: { warehouse_id: t.warehouse_id },
      geometry: ringToPolygon(t.ring),
    })),
  };
}

export function coverageFC(coverage: Coverage): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const wh of coverage.warehouses) {
    if (coverage.mode === "isochrone" && wh.isochrones) {
      for (const iso of wh.isochrones) {
        features.push({
          type: "Feature",
          properties: { label: `${iso.minutes} dk`, band: iso.minutes },
          geometry: iso.geometry,
        });
      }
    } else {
      for (const band of wh.bands) {
        features.push({
          type: "Feature",
          properties: { label: `${band.radius_km} km`, band: band.radius_km },
          geometry: ringToPolygon(band.ring),
        });
      }
    }
  }
  // Largest bands first so smaller ones render on top.
  features.sort((a, b) => (b.properties!.band as number) - (a.properties!.band as number));
  return { type: "FeatureCollection", features };
}

export function flowFC(arcs: FlowArc[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: arcs.map((a) => ({
      type: "Feature",
      properties: { quantity: a.total_quantity, label: `${a.from_name} → ${a.to_name}` },
      geometry: {
        type: "LineString",
        coordinates: [
          [a.from_location.lng, a.from_location.lat],
          [a.to_location.lng, a.to_location.lat],
        ],
      },
    })),
  };
}

/* ── imperative map sync ─────────────────────────────────────────────────── */

export interface NetworkLayerData {
  demand: GeoJSON.FeatureCollection;
  assignments: GeoJSON.FeatureCollection;
  proposed: GeoJSON.FeatureCollection;
  proposedAssignments: GeoJSON.FeatureCollection;
  voronoi: GeoJSON.FeatureCollection;
  coverage: GeoJSON.FeatureCollection;
  flow: GeoJSON.FeatureCollection;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

export function emptyNetworkData(): NetworkLayerData {
  return {
    demand: EMPTY,
    assignments: EMPTY,
    proposed: EMPTY,
    proposedAssignments: EMPTY,
    voronoi: EMPTY,
    coverage: EMPTY,
    flow: EMPTY,
  };
}

function upsertSource(map: MlMap, id: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(id) as { setData?: (d: unknown) => void } | undefined;
  if (source?.setData) source.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

/** Creates sources/layers on first call, then only updates data + visibility. */
export function syncNetworkLayers(
  map: MlMap,
  data: NetworkLayerData,
  toggles: NetworkLayerToggles,
  showCog: boolean,
  beforeId?: string,
): void {
  upsertSource(map, "net-demand", data.demand);
  upsertSource(map, "net-assign", data.assignments);
  upsertSource(map, "net-proposed", data.proposed);
  upsertSource(map, "net-proposed-assign", data.proposedAssignments);
  upsertSource(map, "net-voronoi", data.voronoi);
  upsertSource(map, "net-coverage", data.coverage);
  upsertSource(map, "net-flow", data.flow);

  const layers: { id: string; def: object; visible: boolean }[] = [
    {
      id: "net-coverage-fill",
      visible: toggles.coverage,
      def: {
        type: "fill",
        source: "net-coverage",
        paint: { "fill-color": "#5e8bff", "fill-opacity": 0.06 },
      },
    },
    {
      id: "net-coverage-line",
      visible: toggles.coverage,
      def: {
        type: "line",
        source: "net-coverage",
        paint: { "line-color": "#5e8bff", "line-opacity": 0.45, "line-width": 1.2, "line-dasharray": [3, 2] },
      },
    },
    {
      id: "net-voronoi-fill",
      visible: toggles.voronoi,
      def: {
        type: "fill",
        source: "net-voronoi",
        paint: { "fill-color": "#8a94ad", "fill-opacity": 0.07 },
      },
    },
    {
      id: "net-voronoi-line",
      visible: toggles.voronoi,
      def: {
        type: "line",
        source: "net-voronoi",
        paint: { "line-color": "#8a94ad", "line-opacity": 0.6, "line-width": 1.4 },
      },
    },
    {
      id: "net-flow-line",
      visible: toggles.flow,
      def: {
        type: "line",
        source: "net-flow",
        paint: {
          "line-color": "#e0a93e",
          "line-opacity": 0.8,
          "line-width": ["interpolate", ["linear"], ["get", "quantity"], 1, 1.5, 200, 8],
        },
      },
    },
    {
      id: "net-assign-line",
      visible: toggles.assignments,
      def: {
        type: "line",
        source: "net-assign",
        paint: { "line-color": "#5e8bff", "line-opacity": 0.5, "line-width": 1 },
      },
    },
    {
      id: "net-heat",
      visible: toggles.heatmap,
      def: {
        type: "heatmap",
        source: "net-demand",
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "weight"], 1, 0.2, 25, 1],
          "heatmap-intensity": 1.1,
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 4, 22, 9, 50],
          "heatmap-opacity": 0.75,
        },
      },
    },
    {
      id: "net-demand-circle",
      visible: toggles.customers,
      def: {
        type: "circle",
        source: "net-demand",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["get", "weight"], 1, 3, 25, 11],
          "circle-color": "#9dc1ff",
          "circle-opacity": 0.85,
          "circle-stroke-color": "#0f1522",
          "circle-stroke-width": 1,
        },
      },
    },
    {
      id: "net-proposed-assign-line",
      visible: showCog,
      def: {
        type: "line",
        source: "net-proposed-assign",
        paint: {
          "line-color": "#e0a93e",
          "line-opacity": 0.55,
          "line-width": 1.2,
          "line-dasharray": [2, 2],
        },
      },
    },
    {
      id: "net-proposed-circle",
      visible: showCog,
      def: {
        type: "circle",
        source: "net-proposed",
        paint: {
          "circle-radius": 11,
          "circle-color": "#e0a93e",
          "circle-stroke-color": "#0f1522",
          "circle-stroke-width": 2.5,
        },
      },
    },
  ];

  for (const { id, def, visible } of layers) {
    if (!map.getLayer(id)) {
      map.addLayer({ id, ...(def as object) } as never, beforeId);
    }
    map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
  }
}
