import { useEffect, useRef } from "react";
import maplibregl, { Map as MlMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { LatLng, Warehouse } from "@/types";

/** Token-free OSM raster style, tinted by the container (map sits in an ink well). */
const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap katkıda bulunanlar",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

interface WarehouseMapProps {
  warehouses?: Warehouse[];
  center?: LatLng;
  zoom?: number;
  /** Click sets a location (used by the create/edit form). */
  onMapClick?: (pos: LatLng) => void;
  /** Marker set by the form before saving. */
  draftMarker?: LatLng | null;
  onMarkerClick?: (warehouse: Warehouse) => void;
  className?: string;
}

export function WarehouseMap({
  warehouses = [],
  center,
  zoom = 5.2,
  onMapClick,
  draftMarker,
  onMarkerClick,
  className,
}: WarehouseMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const draftRef = useRef<Marker | null>(null);
  const clickHandlerRef = useRef(onMapClick);
  clickHandlerRef.current = onMapClick;
  const markerClickRef = useRef(onMarkerClick);
  markerClickRef.current = onMarkerClick;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [center?.lng ?? 35.24, center?.lat ?? 39.0],
      zoom,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("click", (e) => {
      clickHandlerRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Mount-once by design: center/zoom only seed the initial view.
  }, []);

  // Warehouse markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = warehouses.map((wh) => {
      const el = document.createElement("button");
      el.className = "depo-marker";
      el.setAttribute("aria-label", wh.name);
      el.style.cssText =
        "width:26px;height:26px;border-radius:6px;border:2px solid #9dc1ff;background:#1d2740;color:#9dc1ff;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,.5)";
      el.textContent = "▣";
      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        markerClickRef.current?.(wh);
      });
      return new maplibregl.Marker({ element: el })
        .setLngLat([wh.location.lng, wh.location.lat])
        .addTo(map);
    });
    if (warehouses.length > 0 && !center) {
      const bounds = new maplibregl.LngLatBounds();
      warehouses.forEach((wh) => bounds.extend([wh.location.lng, wh.location.lat]));
      map.fitBounds(bounds, { padding: 80, maxZoom: 11, duration: 0 });
    }
  }, [warehouses, center]);

  // Draft marker (form placement)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    draftRef.current?.remove();
    draftRef.current = null;
    if (draftMarker) {
      const el = document.createElement("div");
      el.style.cssText =
        "width:14px;height:14px;border-radius:50%;background:#5e8bff;border:2.5px solid #e6eaf4;box-shadow:0 0 0 4px rgba(94,139,255,.25)";
      draftRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([draftMarker.lng, draftMarker.lat])
        .addTo(map);
    }
  }, [draftMarker]);

  return <div ref={containerRef} data-testid="warehouse-map" className={className} />;
}
