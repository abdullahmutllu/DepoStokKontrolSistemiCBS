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
  activeLevelChanged,
  indoorEntered,
  indoorExited,
  measureUpdated,
  ringDrawn,
  warehouseSelected,
} from "@/features/map/mapWorkspaceSlice";
import { useLayout3dQuery } from "@/api/endpoints/warehouses";
import {
  buildIndoorData,
  emptyIndoorData,
  indoorBounds,
  syncIndoorLayers,
} from "@/features/map/indoorLayers";
import { IndoorControl } from "@/features/map/IndoorControl";
import {
  useClosestFacilityQuery,
  useCoverageQuery,
  useDemandPointsQuery,
  useFlowMapQuery,
} from "@/api/endpoints/network";
import { useActiveShipmentsQuery } from "@/api/endpoints/logistics";
import {
  shipmentRoutes,
  syncTrackingLayers,
  tourColor,
  tourRoutes,
  vehicleMarkerHtml,
} from "@/features/map/trackingLayers";
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
  const toursPreview = useAppSelector((s) => s.mapWorkspace.toursPreview);
  const scenarioClosedIds = useAppSelector((s) => s.mapWorkspace.scenarioClosedIds);
  const flowDay = useAppSelector((s) => s.mapWorkspace.flowDay);
  const indoorWarehouseId = useAppSelector((s) => s.mapWorkspace.indoorWarehouseId);
  const activeLevel = useAppSelector((s) => s.mapWorkspace.activeLevel);
  const indoorLayout = useLayout3dQuery(indoorWarehouseId ?? 0, {
    skip: indoorWarehouseId == null,
  });
  // Canlı sevkiyatlar: WS/poll aboneliğini LogisticsPanel yönetir; harita
  // yalnız RTK önbelleğini okur (çift soket açılmaz).
  const shipmentsQuery = useActiveShipmentsQuery();
  const shipments = shipmentsQuery.data ?? [];

  const demand = useDemandPointsQuery(undefined, {
    skip: !networkToggles.customers && !networkToggles.heatmap,
  });
  const closest = useClosestFacilityQuery(undefined, {
    skip: !networkToggles.assignments && !networkToggles.voronoi,
  });
  const coverage = useCoverageQuery(undefined, { skip: !networkToggles.coverage });
  const flow = useFlowMapQuery(flowDay ? { day: flowDay } : undefined, {
    skip: !networkToggles.flow,
  });

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

  // Teslimat turları + canlı sevkiyat rotaları (canlı olan önizlemeyi ezer).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const depot = toursPreview
      ? warehousesRef.current.find((w) => w.id === toursPreview.warehouseId)?.location
      : undefined;
    const routes =
      shipments.length > 0
        ? shipmentRoutes(shipments)
        : toursPreview && depot
          ? tourRoutes(toursPreview.tours, depot)
          : [];
    const beforeId = map
      .getStyle()
      .layers?.find((l) => l.id.startsWith("td-"))?.id;
    syncTrackingLayers(map, routes, beforeId);
  }, [mapReady, toursPreview, shipments]);

  // İç mekân katmanları: bir depoya girilince Layout3D georef ile haritaya
  // projekte edilir; aktif kata göre süzülür; ilk girişte footprint'e uçar.
  const indoorEnteredRef = useRef<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const beforeId = map.getStyle().layers?.find((l) => l.id.startsWith("td-"))?.id;
    if (indoorWarehouseId == null || !indoorLayout.data) {
      syncIndoorLayers(map, emptyIndoorData(), null, beforeId);
      indoorEnteredRef.current = null;
      return;
    }
    syncIndoorLayers(map, buildIndoorData(indoorLayout.data), activeLevel, beforeId);
    if (indoorEnteredRef.current !== indoorWarehouseId) {
      const b = indoorBounds(indoorLayout.data);
      if (b) map.fitBounds(b, { padding: 64, duration: 900, maxZoom: 21 });
      indoorEnteredRef.current = indoorWarehouseId;
    }
  }, [mapReady, indoorWarehouseId, indoorLayout.data, activeLevel]);

  // Canlı araç marker'ları: konum her karede değişir; DOM marker + CSS
  // geçişiyle akıcı kayar, ok simgesi kerterize döner.
  const vehicleMarkersRef = useRef(new Map<number, Marker>());
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const markers = vehicleMarkersRef.current;
    const seen = new Set<number>();
    shipments.forEach((shipment, i) => {
      seen.add(shipment.id);
      const lngLat: [number, number] = [
        shipment.live.position.lng,
        shipment.live.position.lat,
      ];
      const existing = markers.get(shipment.id);
      if (existing) {
        existing.setLngLat(lngLat);
        existing.getElement().innerHTML = vehicleMarkerHtml(shipment, i);
      } else {
        const el = document.createElement("div");
        el.setAttribute("data-testid", `vehicle-${shipment.id}`);
        el.title = `${shipment.vehicle_name} — ${tourColor(i)}`;
        el.style.transition = "transform 1.4s linear"; // poll/WS aralığında süzülme
        el.innerHTML = vehicleMarkerHtml(shipment, i);
        markers.set(
          shipment.id,
          new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map),
        );
      }
    });
    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
  }, [mapReady, shipments]);

  useEffect(
    () => () => {
      vehicleMarkersRef.current.forEach((m) => m.remove());
      vehicleMarkersRef.current.clear();
    },
    [],
  );

  // Occupancy-colored, stock-scaled warehouse markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = warehouses.map((wh) => {
      const { color, sizePx } = markerStyle(wh);
      const closed = scenarioClosedIds.includes(wh.id);
      const el = document.createElement("button");
      el.setAttribute("aria-label", wh.name);
      el.setAttribute("data-testid", `wh-marker-${wh.id}`);
      el.style.cssText = `width:${sizePx}px;height:${sizePx}px;border-radius:8px;border:2px solid ${color};background:#131a2acc;color:${color};display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:${Math.round(sizePx * 0.5)}px;box-shadow:0 2px 10px rgba(0,0,0,.55);backdrop-filter:blur(2px)`;
      if (closed) {
        // what-if: kapalı sayılan depo soluk + üstü çizili görünür
        el.style.opacity = "0.35";
        el.style.filter = "grayscale(1)";
        el.textContent = "✕";
        el.title = `${wh.name} — senaryoda kapalı`;
      } else {
        el.textContent = "▣";
      }
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
  }, [warehouses, dispatch, scenarioClosedIds]);

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
            onEnterIndoor={() => dispatch(indoorEntered(selectedWarehouse.id))}
          />
        </div>
      )}
      {indoorWarehouseId != null && (
        <IndoorControl
          warehouseName={
            warehouses.find((w) => w.id === indoorWarehouseId)?.name ?? "Depo"
          }
          levels={indoorLayout.data?.levels ?? []}
          activeLevel={activeLevel}
          onLevel={(ord) => dispatch(activeLevelChanged(ord))}
          onExit={() => dispatch(indoorExited())}
        />
      )}
    </div>
  );
}
