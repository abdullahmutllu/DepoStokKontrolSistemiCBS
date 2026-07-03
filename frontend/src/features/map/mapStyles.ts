import type { StyleSpecification } from "maplibre-gl";

/** LICENSING NOTE (Esri World Imagery): the keyless tile endpoint below is
 * usable with mandatory attribution, but Esri's terms are NOT unconditionally
 * free (free tier requires an ArcGIS account and non-revenue use). For a
 * commercial deployment, replace this URL with a licensed ArcGIS/MapTiler key
 * endpoint. OSM stays the default basemap so the app remains fully functional
 * if this layer is removed. */
export const ESRI_IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export interface BasemapDef {
  id: string;
  label: string;
}

export const BASEMAPS: BasemapDef[] = [
  { id: "osm", label: "Harita" },
  { id: "esri-uydu", label: "Uydu" },
  { id: "topo", label: "Topoğrafya" },
];

export const DEFAULT_BASEMAP = "osm";

/** One combined style with every basemap as a toggleable raster layer.
 * Basemap switching MUST use setLayoutProperty(visibility) — never
 * map.setStyle(), which would wipe Terra Draw's layers. */
export function buildWorkspaceStyle(): StyleSpecification {
  return {
    version: 8,
    // drei Text/glyphs not needed; raster-only style requires no glyph/sprite.
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap katkıda bulunanlar",
      },
      "esri-uydu": {
        type: "raster",
        tiles: [ESRI_IMAGERY_URL],
        tileSize: 256,
        attribution:
          "Powered by Esri | Kaynak: Esri, Maxar, Earthstar Geographics, GIS User Community",
      },
      topo: {
        type: "raster",
        tiles: ["https://tile.opentopomap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap katkıda bulunanlar, SRTM | © OpenTopoMap (CC-BY-SA)",
      },
    },
    layers: BASEMAPS.map(({ id }) => ({
      id,
      type: "raster" as const,
      source: id,
      layout: { visibility: id === DEFAULT_BASEMAP ? ("visible" as const) : ("none" as const) },
    })),
  };
}
