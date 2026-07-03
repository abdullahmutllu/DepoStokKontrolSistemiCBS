/** The ONLY module that imports terra-draw. Everything else talks to this
 * controller, so the library stays swappable and singly mocked in tests. */

import {
  TerraDraw,
  TerraDrawCircleMode,
  TerraDrawLineStringMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawSelectMode,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import type { Map as MlMap } from "maplibre-gl";
import type { Feature, LineString, Polygon } from "geojson";
import type { MapTool } from "@/features/map/mapWorkspaceSlice";

export interface DrawCallbacks {
  /** Fired when a polygon/rectangle/circle is completed. */
  onPolygonFinish: (feature: Feature<Polygon>) => void;
  /** Fired as a measure line is drawn/updated and when finished. */
  onLineChange: (feature: Feature<LineString> | null) => void;
}

export interface DrawController {
  setTool(tool: MapTool): void;
  clear(): void;
  addPolygon(feature: Feature<Polygon>): void;
  destroy(): void;
}

// Control-room styling: accent outline, 18% fill.
const ACCENT = "#5e8bff";
const FILL = "#5e8bff";
const polygonStyle = {
  fillColor: FILL as `#${string}`,
  fillOpacity: 0.18,
  outlineColor: ACCENT as `#${string}`,
  outlineWidth: 2,
};

const TOOL_TO_MODE: Record<MapTool, string> = {
  pan: "static",
  select: "select",
  polygon: "polygon",
  rectangle: "rectangle",
  circle: "circle",
  "measure-line": "linestring",
};

export function createDrawController(map: MlMap, callbacks: DrawCallbacks): DrawController {
  const draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawPolygonMode({ styles: polygonStyle }),
      new TerraDrawRectangleMode({ styles: polygonStyle }),
      new TerraDrawCircleMode({ styles: polygonStyle }),
      new TerraDrawLineStringMode({
        styles: { lineStringColor: "#e0a93e", lineStringWidth: 3 },
      }),
      new TerraDrawSelectMode({
        flags: {
          polygon: {
            feature: { draggable: true, coordinates: { midpoints: true, draggable: true } },
          },
          rectangle: { feature: { draggable: true } },
          circle: { feature: { draggable: true } },
          linestring: { feature: { draggable: true } },
        },
      }),
    ],
  });

  draw.start();
  draw.setMode("static");

  draw.on("finish", (id) => {
    const feature = draw.getSnapshot().find((f) => f.id === id);
    if (!feature) return;
    if (feature.geometry.type === "Polygon") {
      callbacks.onPolygonFinish(feature as Feature<Polygon>);
      draw.setMode("static");
    } else if (feature.geometry.type === "LineString") {
      callbacks.onLineChange(feature as Feature<LineString>);
    }
  });

  draw.on("change", () => {
    const lines = draw
      .getSnapshot()
      .filter((f) => f.geometry.type === "LineString") as Feature<LineString>[];
    callbacks.onLineChange(lines.length ? lines[lines.length - 1] : null);
  });

  return {
    setTool(tool: MapTool) {
      draw.setMode(TOOL_TO_MODE[tool] ?? "static");
    },
    clear() {
      draw.clear();
      callbacks.onLineChange(null);
    },
    addPolygon(feature: Feature<Polygon>) {
      draw.clear();
      draw.addFeatures([
        { ...feature, properties: { ...feature.properties, mode: "polygon" } },
      ]);
    },
    destroy() {
      try {
        draw.stop();
      } catch {
        // map already removed
      }
    },
  };
}
