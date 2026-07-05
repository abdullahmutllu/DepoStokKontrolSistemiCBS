import { describe, expect, it } from "vitest";
import type { Map as MlMap } from "maplibre-gl";
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
import type { NetworkLayerToggles } from "@/features/map/mapWorkspaceSlice";
import type { CenterOfGravity, ClosestFacility, Coverage } from "@/types";
import { demoClosestFacility, demoCog, demoCoverage } from "@/test/mocks/handlers";

const ALL_OFF: NetworkLayerToggles = {
  customers: false,
  heatmap: false,
  assignments: false,
  voronoi: false,
  coverage: false,
  flow: false,
};

describe("networkLayers saf kurucular", () => {
  it("demandFC lng/lat sırasıyla nokta ve weight property üretir", () => {
    const fc = demandFC([
      { id: 1, name: "A", location: { lat: 40, lng: 30 }, weight: 7 },
    ]);
    expect(fc.features).toHaveLength(1);
    const f = fc.features[0];
    expect(f.geometry).toEqual({ type: "Point", coordinates: [30, 40] });
    expect(f.properties).toMatchObject({ name: "A", weight: 7 });
  });

  it("assignmentFC iki noktalı çizgi + kind property üretir", () => {
    const fc = assignmentFC(
      [
        {
          customer_id: 1,
          from_location: { lat: 40, lng: 30 },
          to_location: { lat: 41, lng: 29 },
          weight: 3,
          distance_m: 1000,
        },
      ],
      "proposed",
    );
    expect(fc.features[0].geometry).toEqual({
      type: "LineString",
      coordinates: [
        [30, 40],
        [29, 41],
      ],
    });
    expect(fc.features[0].properties?.kind).toBe("proposed");
  });

  it("voronoiFC halkayı kapatır (ilk == son koordinat)", () => {
    const fc = voronoiFC(demoClosestFacility as ClosestFacility);
    const ring = (fc.features[0].geometry as GeoJSON.Polygon).coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring.length).toBe(5); // 4 nokta + kapanış
  });

  it("coverageFC bantları büyükten küçüğe sıralar (küçük üstte çizilsin)", () => {
    const fc = coverageFC(demoCoverage as Coverage);
    const bands = fc.features.map((f) => f.properties?.band);
    expect(bands).toEqual([50, 25, 10]);
    expect(fc.features[0].properties?.label).toBe("50 km");
  });

  it("coverageFC isochrone modunda geometriyi doğrudan kullanır", () => {
    const iso: Coverage = {
      mode: "isochrone",
      note: "Sürüş süresi — ORS",
      uncovered_customers: 0,
      uncovered_weight: 0,
      warehouses: [
        {
          warehouse_id: 3,
          warehouse_name: "X",
          bands: [],
          isochrones: [
            {
              minutes: 30,
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [28, 41],
                    [29, 41],
                    [29, 42],
                    [28, 41],
                  ],
                ],
              },
            },
          ],
        },
      ],
    };
    const fc = coverageFC(iso);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties?.label).toBe("30 dk");
    expect(fc.features[0].geometry.type).toBe("Polygon");
  });

  it("proposedSitesFC sıra numarası ve ağırlık taşır", () => {
    const fc = proposedSitesFC(demoCog as CenterOfGravity);
    expect(fc.features[0].properties).toMatchObject({ index: 1, weight: 58 });
  });

  it("flowFC kalınlık için quantity property'si üretir", () => {
    const fc = flowFC([
      {
        from_warehouse_id: 1,
        from_name: "A",
        from_location: { lat: 40, lng: 30 },
        to_warehouse_id: 2,
        to_name: "B",
        to_location: { lat: 41, lng: 31 },
        total_quantity: 120,
        transfer_count: 4,
      },
    ]);
    expect(fc.features[0].properties).toMatchObject({ quantity: 120, label: "A → B" });
  });
});

describe("syncNetworkLayers", () => {
  function fakeMap() {
    const sources: Record<string, { data: unknown }> = {};
    const layers: { id: string; beforeId?: string }[] = [];
    const visibility: Record<string, string> = {};
    const map = {
      sources,
      layers,
      visibility,
      addSource: (id: string, def: { data: unknown }) => {
        sources[id] = { data: def.data };
      },
      getSource: (id: string) =>
        sources[id]
          ? {
              setData: (d: unknown) => {
                sources[id].data = d;
              },
            }
          : undefined,
      addLayer: (def: { id: string }, beforeId?: string) => {
        layers.push({ id: def.id, beforeId });
      },
      getLayer: (id: string) => layers.find((l) => l.id === id),
      setLayoutProperty: (id: string, _prop: string, value: string) => {
        visibility[id] = value;
      },
    };
    return map as typeof map & MlMap;
  }

  it("ilk çağrıda tüm katmanları beforeId ile Terra Draw altına ekler", () => {
    const map = fakeMap();
    syncNetworkLayers(map, emptyNetworkData(), ALL_OFF, false, "td-polygon");
    expect(map.layers.length).toBe(10);
    expect(map.layers.every((l) => l.beforeId === "td-polygon")).toBe(true);
    expect(Object.values(map.visibility).every((v) => v === "none")).toBe(true);
  });

  it("ikinci çağrı katman eklemez, veriyi setData ile günceller ve görünürlüğü açar", () => {
    const map = fakeMap();
    syncNetworkLayers(map, emptyNetworkData(), ALL_OFF, false);
    const layerCount = map.layers.length;

    const data = emptyNetworkData();
    data.demand = demandFC([{ id: 1, name: "A", location: { lat: 40, lng: 30 }, weight: 5 }]);
    syncNetworkLayers(map, data, { ...ALL_OFF, customers: true, heatmap: true }, true);

    expect(map.layers.length).toBe(layerCount); // duplicate yok
    expect(
      (map.sources["net-demand"].data as GeoJSON.FeatureCollection).features,
    ).toHaveLength(1);
    expect(map.visibility["net-demand-circle"]).toBe("visible");
    expect(map.visibility["net-heat"]).toBe("visible");
    expect(map.visibility["net-proposed-circle"]).toBe("visible"); // showCog
    expect(map.visibility["net-voronoi-fill"]).toBe("none");
  });
});
