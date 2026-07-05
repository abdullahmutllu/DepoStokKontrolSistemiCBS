import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "@/test/mocks/server";

// ── jsdom polyfills Radix/shadcn-style components rely on ──────────────────
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver ?? (ResizeObserverStub as never);
window.matchMedia =
  window.matchMedia ??
  ((query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList);
URL.createObjectURL = URL.createObjectURL ?? (() => "blob:mock");
URL.revokeObjectURL = URL.revokeObjectURL ?? (() => {});
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

// ── module mocks: the real libs must NEVER load in jsdom ───────────────────
vi.mock("maplibre-gl", () => {
  class MockMap {
    handlers: Record<string, ((e: unknown) => void)[]> = {};
    layoutProps: Record<string, string> = {};
    sources: Record<string, { type: string; data: unknown }> = {};
    constructor() {
      (window as unknown as Record<string, unknown>).__mockMap = this;
      // GisMap waits for "load" before wiring the draw controller.
      queueMicrotask(() => this.fire("load", {}));
    }
    on(event: string, cb: (e: unknown) => void) {
      (this.handlers[event] ??= []).push(cb);
      return this;
    }
    off(event: string, cb: (e: unknown) => void) {
      this.handlers[event] = (this.handlers[event] ?? []).filter((h) => h !== cb);
      return this;
    }
    fire(event: string, payload: unknown) {
      this.handlers[event]?.forEach((cb) => cb(payload));
    }
    addControl() {
      return this;
    }
    fitBounds() {}
    remove() {}
    getCanvas() {
      return document.createElement("canvas");
    }
    getLayer(id: string) {
      return { id };
    }
    setLayoutProperty(id: string, _prop: string, value: string) {
      this.layoutProps[id] = value;
    }
    addSource(id: string, def: { type: string; data: unknown }) {
      this.sources[id] = def;
    }
    getSource(id: string) {
      const src = this.sources[id];
      if (!src) return undefined;
      return {
        setData: (d: unknown) => {
          src.data = d;
        },
      };
    }
    addLayer() {}
    getStyle() {
      return { layers: [{ id: "osm" }, { id: "td-polygon" }] };
    }
    project() {
      return { x: 120, y: 160 };
    }
  }
  class MockMarker {
    element: HTMLElement | undefined;
    constructor(opts?: { element?: HTMLElement }) {
      this.element = opts?.element;
    }
    setLngLat() {
      return this;
    }
    addTo() {
      if (this.element) document.body.appendChild(this.element);
      return this;
    }
    remove() {
      this.element?.remove();
    }
  }
  class MockLngLatBounds {
    extend() {
      return this;
    }
  }
  const api = {
    Map: MockMap,
    Marker: MockMarker,
    NavigationControl: class {},
    LngLatBounds: MockLngLatBounds,
  };
  return { default: api, ...api };
});
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

vi.mock("terra-draw", () => {
  class MockTerraDraw {
    handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
    features: unknown[] = [];
    mode = "static";
    constructor() {
      (window as unknown as Record<string, unknown>).__mockDraw = this;
    }
    start() {}
    stop() {}
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.handlers[event] ??= []).push(cb);
    }
    fire(event: string, ...args: unknown[]) {
      this.handlers[event]?.forEach((cb) => cb(...args));
    }
    setMode(mode: string) {
      this.mode = mode;
    }
    getSnapshot() {
      return this.features;
    }
    addFeatures(features: unknown[]) {
      this.features.push(...features);
    }
    clear() {
      this.features = [];
    }
  }
  const mode = (m: string) =>
    class {
      mode = m;
      constructor(public opts?: unknown) {}
    };
  return {
    TerraDraw: MockTerraDraw,
    TerraDrawPolygonMode: mode("polygon"),
    TerraDrawRectangleMode: mode("rectangle"),
    TerraDrawCircleMode: mode("circle"),
    TerraDrawLineStringMode: mode("linestring"),
    TerraDrawSelectMode: mode("select"),
  };
});

vi.mock("terra-draw-maplibre-gl-adapter", () => ({
  TerraDrawMapLibreGLAdapter: class {
    constructor(public opts?: unknown) {}
    register() {}
    unregister() {}
  },
}));

vi.mock("@react-three/fiber", () => ({
  // Never render children: three elements cannot mount in jsdom.
  Canvas: (props: Record<string, unknown>) => (
    <div data-testid="r3f-canvas" aria-label="3B sahne yer tutucusu" data-bins={String(props["data-bins"] ?? "")} />
  ),
  useFrame: () => {},
  useThree: () => ({}),
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: () => null,
  Instances: () => null,
  Instance: () => null,
  Text: () => null,
  Edges: () => null,
  Grid: () => null,
  Environment: () => null,
  Line: () => null,
  Billboard: () => null,
  PointerLockControls: () => null,
  useGLTF: Object.assign(() => ({ scene: {}, nodes: {}, materials: {} }), {
    preload: () => {},
  }),
}));

vi.mock("@react-three/postprocessing", () => ({
  EffectComposer: () => null,
  N8AO: () => null,
  Bloom: () => null,
  SMAA: () => null,
}));

// ── MSW ─────────────────────────────────────────────────────────────────────
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  localStorage.clear();
});
afterAll(() => server.close());
