import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Feature, LineString, Polygon } from "geojson";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { Warehouse } from "@/types";
import { BASEMAPS, buildWorkspaceStyle } from "@/features/map/mapStyles";
import { createDrawController, type DrawController } from "@/features/map/drawController";
import { featureToRing, lineLengthM, markerStyle, ringToFeature } from "@/features/map/geometry";
import {
  measureUpdated,
  ringDrawn,
  warehouseSelected,
} from "@/features/map/mapWorkspaceSlice";
import {
  useClosestFacilityQuery,
  useCoverageQuery,
  useDemandPointsQuery,
  useFlowMapQuery,
} from "@/api/endpoints/network";
import {
  assignmentFC,
  coverageFC,
  demandFC,
  emptyNetworkData,
  flowFC,
  proposedSitesFC,
  syncNetworkLayers,
  voronoiFC,
} from "@/features/map/networkLayers";
import { WarehousePopup } from "@/features/map/WarehousePopup";
import { MapLegend } from "@/features/map/MapLegend";

interface GisMapProps {
  warehouses: Warehouse[];
}

export function GisMap({ warehouses }: GisMapProps) {
  const dispatch = useAppDispatch();
  const activeTool = useAppSelector((s) => s.mapWorkspace.activeTool);
  const basemapId = useAppSelector((s) => s.mapWorkspace.basemapId);
  const selectedWarehouseId = useAppSelector((s) => s.mapWorkspace.selectedWarehouseId);
  const analysisRing = useAppSelector((s) => s.mapWorkspace.analysisRing);
  const networkToggles = useAppSelector((s) => s.mapWorkspace.networkLayers);
  const cogResult = useAppSelector((s) => s.mapWorkspace.cogResult);

  const demand = useDemandPointsQuery(undefined, {
    skip: !networkToggles.customers && !networkToggles.heatmap,
  });
  const closest = useClosestFacilityQuery(undefined, {
    skip: !networkToggles.assignments && !networkToggles.voronoi,
  });
  const coverage = useCoverageQuery(undefined, { skip: !networkToggles.coverage });
  const flow = useFlowMapQuery(undefined, { skip: !networkToggles.flow });

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const drawRef = useRef<DrawController | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [popupAnchor, setPopupAnchor] = useState<{ x: number; y: number } | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const warehousesRef = useRef(warehouses);
  warehousesRef.current = warehouses;

  // Mount-once map + draw controller.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildWorkspaceStyle(),
      // Açılışta tüm Türkiye çerçevelenir (Edirne–Iğdır, Hatay–Sinop).
      bounds: [
        [25.5, 35.7],
        [45.2, 42.4],
      ],
      fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      drawRef.current = createDrawController(map, {
        onPolygonFinish: (feature: Feature<Polygon>) => {
          dispatch(ringDrawn(featureToRing(feature)));
        },
        onLineChange: (feature: Feature<LineString> | null) => {
          if (!feature) {
            dispatch(measureUpdated(null));
            return;
          }
          const meters = lineLengthM(
            feature.geometry.coordinates as [number, number][],
          );
          dispatch(measureUpdated(meters > 0 ? { kind: "line", value: meters } : null));
        },
      });
      setMapReady(true);
    });

    return () => {
      drawRef.current?.destroy();
      drawRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // Mount-once by design; draw callbacks read state through refs/dispatch.
  }, []);

  // Basemap visibility toggle — never setStyle() (it would wipe draw layers).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const { id } of BASEMAPS) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", id === basemapId ? "visible" : "none");
      }
    }
  }, [basemapId, mapReady]);

  // Tool → draw mode sync.
  useEffect(() => {
    drawRef.current?.setTool(activeTool);
    const canvas = mapRef.current?.getCanvas();
    if (canvas) {
      canvas.style.cursor = activeTool === "pan" ? "" : "crosshair";
    }
  }, [activeTool, mapReady]);

  // Load a saved/drawn ring back onto the map.
  useEffect(() => {
    if (!mapReady) return;
    if (analysisRing && analysisRing.length >= 3) {
      drawRef.current?.addPolygon(ringToFeature(analysisRing));
    } else if (analysisRing === null) {
      drawRef.current?.clear();
    }
  }, [analysisRing, mapReady]);

  // Network-analysis layers — kept BELOW Terra Draw's layers so drawings stay
  // interactive; visibility (not add/remove) toggling survives basemap switches.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const data = emptyNetworkData();
    if (demand.data) data.demand = demandFC(demand.data);
    if (closest.data) {
      data.assignments = assignmentFC(closest.data.assignments, "current");
      data.voronoi = voronoiFC(closest.data);
    }
    if (coverage.data) data.coverage = coverageFC(coverage.data);
    if (flow.data) data.flow = flowFC(flow.data.arcs);
    if (cogResult) {
      data.proposed = proposedSitesFC(cogResult);
      data.proposedAssignments = assignmentFC(cogResult.assignments, "proposed");
    }
    const beforeId = map
      .getStyle()
      .layers?.find((l) => l.id.startsWith("td-"))?.id;
    syncNetworkLayers(map, data, networkToggles, cogResult !== null, beforeId);
  }, [
    mapReady,
    networkToggles,
    cogResult,
    demand.data,
    closest.data,
    coverage.data,
    flow.data,
  ]);

  // Occupancy-colored, stock-scaled warehouse markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = warehouses.map((wh) => {
      const { color, sizePx } = markerStyle(wh);
      const el = document.createElement("button");
      el.setAttribute("aria-label", wh.name);
      el.setAttribute("data-testid", `wh-marker-${wh.id}`);
      el.style.cssText = `width:${sizePx}px;height:${sizePx}px;border-radius:8px;border:2px solid ${color};background:#131a2acc;color:${color};display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:${Math.round(sizePx * 0.5)}px;box-shadow:0 2px 10px rgba(0,0,0,.55);backdrop-filter:blur(2px)`;
      el.textContent = "▣";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        dispatch(warehouseSelected(wh.id));
      });
      return new maplibregl.Marker({ element: el })
        .setLngLat([wh.location.lng, wh.location.lat])
        .addTo(map);
    });
    // Not: depo sınırlarına zoom YAPILMAZ — açılış çerçevesi her zaman tüm
    // Türkiye'dir (kurucudaki bounds); kullanıcı isterse kendisi yaklaşır.
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
    };
  }, [warehouses, dispatch]);

  // Popup anchoring: project the selected warehouse, re-anchor on map move.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const selected = warehousesRef.current.find((w) => w.id === selectedWarehouseId);
    if (!selected) {
      setPopupAnchor(null);
      return;
    }
    const update = () => {
      const p = map.project([selected.location.lng, selected.location.lat]);
      setPopupAnchor({ x: p.x, y: p.y });
    };
    update();
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [selectedWarehouseId]);

  const selectedWarehouse = warehouses.find((w) => w.id === selectedWarehouseId) ?? null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-ink-950">
      <div ref={containerRef} data-testid="gis-map" className="h-full w-full" />
      <MapLegend />
      {selectedWarehouse && popupAnchor && (
        <div
          className="absolute z-20"
          style={{
            left: popupAnchor.x,
            top: popupAnchor.y - 12,
            transform: "translate(-50%, -100%)",
          }}
        >
          <WarehousePopup
            warehouse={selectedWarehouse}
            onClose={() => dispatch(warehouseSelected(null))}
          />
        </div>
      )}
    </div>
  );
}
