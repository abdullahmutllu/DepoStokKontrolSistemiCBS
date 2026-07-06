import { describe, expect, it } from "vitest";
import {
  buildBinAlertPins,
  buildBinInstance,
  buildDockDoors,
  buildLedStrips,
  buildPalletPlacements,
  buildProps,
  buildRackAlertPins,
  buildRackFrames,
  buildRackSigns,
  buildSafetyMarkings,
  buildSceneModel,
  buildWalls,
  buildZoneMarkings,
  cameraPresets,
  palletStackLayers,
  sceneHeight,
  type ZoneQuad,
} from "@/features/three/sceneModel";
import { demoLayout } from "@/test/mocks/handlers";

describe("buildSceneModel", () => {
  const model = buildSceneModel(demoLayout);

  it("maps floor dimensions from the warehouse", () => {
    expect(model.floor).toEqual({ width: 40, depth: 25 });
  });

  it("converts warehouse-local coords to three.js y-up frame", () => {
    // Bin 103: pos (1,1,1.5) dims (1,1,1.5) → center x=1.5, y(height)=1.5+0.75, z(depth)=1.5
    const upper = model.bins.find((b) => b.id === 103)!;
    expect(upper.center[0]).toBeCloseTo(1.5);
    expect(upper.center[1]).toBeCloseTo(2.25);
    expect(upper.center[2]).toBeCloseTo(1.5);
  });

  it("shrinks bin shells by the visual inset", () => {
    const bin = model.bins.find((b) => b.id === 101)!;
    expect(bin.size[0]).toBeLessThan(1);
    expect(bin.size[0]).toBeGreaterThan(0.9);
  });

  it("assigns occupancy buckets from quantity/capacity", () => {
    expect(model.bins.find((b) => b.id === 101)!.bucket).toBe("low"); // 30/100
    expect(model.bins.find((b) => b.id === 102)!.bucket).toBe("empty"); // 0/100
    expect(model.bins.find((b) => b.id === 103)!.bucket).toBe("high"); // 95/100
  });

  it("scales fill boxes by occupancy ratio, seated at cell bottom", () => {
    const low = model.bins.find((b) => b.id === 101)!; // 30/100
    const high = model.bins.find((b) => b.id === 103)!; // 95/100
    const empty = model.bins.find((b) => b.id === 102)!;

    expect(low.fillRatio).toBeCloseTo(0.3);
    expect(high.fillRatio).toBeCloseTo(0.95);
    expect(high.fillSize[1]).toBeGreaterThan(low.fillSize[1]);
    // Empty bin: no visible fill volume.
    expect(empty.fillSize[1]).toBeLessThanOrEqual(0.01);
    // Fill sits inside the cell: fill top ≤ shell top.
    const fillTop = low.fillCenter[1] + low.fillSize[1] / 2;
    const shellTop = low.center[1] + low.size[1] / 2;
    expect(fillTop).toBeLessThanOrEqual(shellTop + 1e-6);
  });

  it("carries rack frames with full (uninset) dimensions", () => {
    expect(model.racks).toHaveLength(1);
    expect(model.racks[0].size).toEqual([4, 3, 1]);
    expect(model.racks[0].code).toBe("Z1-A1-R1");
  });
});

describe("buildRackFrames", () => {
  const rack = demoLayout.racks[0]; // 4m wide, 1m deep, 3m tall at (1,1)
  const members = buildRackFrames(rack, demoLayout.shelves);

  it("places uprights at bay boundaries on both faces", () => {
    const posts = members.filter((m) => m.part === "post");
    // 4m / 2.8m bay → 2 bays → 3 post positions × 2 faces = 6
    expect(posts).toHaveLength(6);
    for (const p of posts) {
      expect(p.size[1]).toBeCloseTo(rack.dim_h); // full height
      // Posts sit on the rack's front/back faces.
      const zFront = rack.pos_y + 0.045;
      const zBack = rack.pos_y + rack.dim_d - 0.045;
      expect([zFront, zBack].some((z) => Math.abs(p.center[2] - z) < 1e-6)).toBe(true);
    }
  });

  it("adds two beams + one deck per real shelf level", () => {
    const beams = members.filter((m) => m.part === "beam");
    const decks = members.filter((m) => m.part === "deck");
    expect(beams).toHaveLength(2 * demoLayout.shelves.length);
    expect(decks).toHaveLength(demoLayout.shelves.length);
    // Second shelf's beams sit at its pos_z.
    const upperBeams = beams.filter((b) => Math.abs(b.center[1] - (1.5 + 0.06)) < 1e-6);
    expect(upperBeams).toHaveLength(2);
  });

  it("spans beams across the full rack width", () => {
    const beam = members.find((m) => m.part === "beam")!;
    expect(beam.size[0]).toBeCloseTo(rack.dim_w);
  });
});

describe("buildWalls", () => {
  const walls = buildWalls(40, 25, 5);

  it("builds 5 wall slabs (south split by door) + 4 columns", () => {
    expect(walls.filter((w) => w.part === "wall")).toHaveLength(5);
    expect(walls.filter((w) => w.part === "column")).toHaveLength(4);
  });

  it("leaves a door-sized gap centered on the south wall", () => {
    const south = walls
      .filter((w) => w.part === "wall" && Math.abs(w.center[2] - 0.125) < 1e-6)
      .sort((a, b) => a.center[0] - b.center[0]);
    expect(south).toHaveLength(2);
    const leftEnd = south[0].center[0] + south[0].size[0] / 2;
    const rightStart = south[1].center[0] - south[1].size[0] / 2;
    expect(rightStart - leftEnd).toBeCloseTo(6); // DOOR_W
    // Gap is centered.
    expect((leftEnd + rightStart) / 2).toBeCloseTo(20);
  });

  it("walls reach the requested height", () => {
    for (const w of walls.filter((w) => w.part === "wall")) {
      expect(w.size[1]).toBeCloseTo(5);
      expect(w.center[1]).toBeCloseTo(2.5);
    }
  });
});

describe("sceneHeight & markings & presets", () => {
  it("derives wall height from the tallest rack + clearance (min 4m)", () => {
    expect(sceneHeight(demoLayout.racks, demoLayout.bins)).toBeCloseTo(4.2); // 3m rack + 1.2
    expect(sceneHeight([], [])).toBe(4);
  });

  it("builds floor quads with labels for zones and aisles", () => {
    const quads = buildZoneMarkings(
      [{ ...demoLayout.racks[0], id: 1, type: "zone", code: "Z1" }],
      [{ ...demoLayout.racks[0], id: 2, type: "aisle", code: "Z1-A1" }],
    );
    expect(quads).toHaveLength(2);
    expect(quads[0].kind).toBe("zone");
    expect(quads[0].center[1]).toBeGreaterThan(0); // floats above floor
    expect(quads[1].code).toBe("Z1-A1");
  });

  it("camera presets frame the floor", () => {
    const presets = cameraPresets({ width: 40, depth: 25 });
    expect(presets.map((p) => p.id)).toEqual(["isometric", "top", "front", "reset"]);
    const top = presets.find((p) => p.id === "top")!;
    expect(top.position[1]).toBeGreaterThan(40); // above the span
    expect(top.target).toEqual([20, 0, 12.5]);
  });
});

describe("buildDockDoors", () => {
  it("büyük depoda güney (açık) + 2 kuzey (kapalı) kepenk üretir", () => {
    const parts = buildDockDoors(40, 25, 6);
    const rolls = parts.filter((p) => p.part === "roll");
    const rails = parts.filter((p) => p.part === "rail");
    expect(rolls).toHaveLength(3); // 1 güney + 2 kuzey
    expect(rails).toHaveLength(6); // kapı başına 2 ray
    // Kuzey kapılar kuzey duvar düzleminde (z ≈ depth - WALL_T/2).
    const northRolls = rolls.filter((r) => r.center[2] > 20);
    expect(northRolls).toHaveLength(2);
  });

  it("güney kepenk çoğunlukla açık: kuzey kapıdan az rib taşır", () => {
    const parts = buildDockDoors(40, 25, 6);
    const southRibs = parts.filter((p) => p.part === "rib" && p.center[2] < 1);
    const northRibs = parts.filter((p) => p.part === "rib" && p.center[2] > 20);
    expect(southRibs.length).toBeGreaterThan(0);
    expect(northRibs.length / 2).toBeGreaterThan(southRibs.length); // kapı başına
  });

  it("küçük depoda kuzey dokları atlar", () => {
    const parts = buildDockDoors(10, 8, 4);
    expect(parts.filter((p) => p.part === "roll")).toHaveLength(1);
  });
});

describe("buildSafetyMarkings", () => {
  const aisle: ZoneQuad = {
    id: 2,
    code: "Z1-A1",
    kind: "aisle",
    center: [10, 0.014, 5],
    size: [16, 3],
    labelPos: [0, 0, 0],
  };

  it("koridor başına iki kenar çizgisi, uzun eksene paralel", () => {
    const marks = buildSafetyMarkings(40, 25, [aisle]);
    const lines = marks.filter((m) => m.kind === "line");
    expect(lines).toHaveLength(2);
    // Yatay koridor (w>d): çizgiler z kenarlarında, koridor genişliğini kaplar.
    expect(lines[0].size[0]).toBeCloseTo(16);
    const edges = lines.map((l) => l.center[2]).sort((a, b) => a - b);
    expect(edges).toEqual([3.5, 6.5]);
  });

  it("kapı önüne 45° taralı şeritler koyar", () => {
    const marks = buildSafetyMarkings(40, 25, []);
    const hatches = marks.filter((m) => m.kind === "hatch");
    expect(hatches.length).toBeGreaterThanOrEqual(3);
    for (const h of hatches) {
      expect(h.rotationY).toBeCloseTo(Math.PI / 4);
      expect(h.center[2]).toBeGreaterThan(0.25); // duvarın önünde
      expect(h.center[2]).toBeLessThan(3);
    }
  });
});

describe("gerçekçi mod kurucuları", () => {
  it("palletStackLayers doluluk oranını 0-4 katmana eşler", () => {
    expect(palletStackLayers(0)).toBe(0);
    expect(palletStackLayers(0.1)).toBe(1);
    expect(palletStackLayers(0.45)).toBe(2);
    expect(palletStackLayers(0.7)).toBe(3);
    expect(palletStackLayers(0.95)).toBe(4);
  });

  it("buildPalletPlacements boş gözleri atlar, paleti göz tabanına oturtur", () => {
    const bins = demoLayout.bins.map(buildBinInstance);
    const placements = buildPalletPlacements(bins);
    expect(placements).toHaveLength(2); // 102 boş → yok
    const low = placements.find((p) => p.binId === 101)!; // 30/100
    const binLow = bins.find((b) => b.id === 101)!;
    const binBottom = binLow.center[1] - binLow.size[1] / 2;
    expect(low.center[1]).toBeCloseTo(binBottom + 0.144 / 2);
    expect(low.layers).toBe(2); // 0.3 → 2 katman
    expect(low.boxKind).toBe("stack");
    // Koliler paletin üstünde başlar.
    expect(low.boxCenter![1] - low.boxSize![1] / 2).toBeCloseTo(binBottom + 0.144, 5);
  });

  it("buildLedStrips şeridi gözün ön-alt kenarına koyar", () => {
    const bins = demoLayout.bins.map(buildBinInstance);
    const strips = buildLedStrips(bins);
    expect(strips).toHaveLength(bins.length);
    const s = strips.find((x) => x.binId === 101)!;
    const bin = bins.find((b) => b.id === 101)!;
    expect(s.center[2]).toBeLessThan(bin.center[2]); // ön yüz (−z)
    expect(s.center[1]).toBeLessThan(bin.center[1]); // alt kenar
    expect(s.bucket).toBe("low");
  });

  it("buildProps küçük depoda 1, büyükte 2 forklift yerleştirir", () => {
    expect(buildProps(12, 10)).toHaveLength(1);
    const two = buildProps(40, 25);
    expect(two).toHaveLength(2);
    for (const p of two) {
      expect(p.center[0]).toBeGreaterThan(0);
      expect(p.center[0]).toBeLessThan(40);
    }
  });

  it("buildRackSigns tabelayı rafın üstüne, ön yüze asar", () => {
    const model = buildSceneModel(demoLayout);
    const signs = buildRackSigns(model.racks);
    expect(signs).toHaveLength(1);
    const rack = model.racks[0];
    expect(signs[0].code).toBe("Z1-A1-R1");
    expect(signs[0].center[1]).toBeGreaterThan(rack.center[1] + rack.size[1] / 2);
    expect(signs[0].center[2]).toBeLessThan(rack.center[2] - rack.size[2] / 2);
  });

  it("buildSceneModel yeni katmanları içerir", () => {
    const model = buildSceneModel(demoLayout);
    expect(model.dock.length).toBeGreaterThan(0);
    expect(model.signs).toHaveLength(model.racks.length);
    expect(model.props.length).toBeGreaterThanOrEqual(1);
    expect(model.safety.some((m) => m.kind === "hatch")).toBe(true);
  });
});

describe("stok uyarı pinleri", () => {
  const bins = demoLayout.bins.map(buildBinInstance); // 101 critical, 103 warning

  it("buildBinAlertPins yalnız alert'li gözlere, SKU · stok/eşik rozetiyle pin koyar", () => {
    const pins = buildBinAlertPins(bins);
    expect(pins).toHaveLength(2);
    const critical = pins.find((p) => p.refId === 101)!;
    expect(critical.level).toBe("critical");
    expect(critical.label).toBe("PLT-EUR · 5/20"); // rozet metni: ürün + sayı
    // tıklama hedefi + detay bağlamı taşınır
    expect(critical.binId).toBe(101);
    expect(critical.sku).toBe("PLT-EUR");
    expect(critical.total).toBe(5);
    expect(critical.threshold).toBe(20);
    const bin = bins.find((b) => b.id === 101)!;
    expect(critical.tip[1]).toBeGreaterThan(bin.center[1] + bin.size[1] / 2);
    expect(pins.some((p) => p.refId === 102)).toBe(false); // alert'siz göz pin almaz
  });

  it("bağlam yoksa rozet seviye metnine düşer", () => {
    const stripped = bins.map((b) => ({ ...b, alertSku: null }));
    const pins = buildBinAlertPins(stripped);
    expect(pins.find((p) => p.level === "critical")!.label).toBe("KRİTİK STOK");
    expect(pins.find((p) => p.level === "warning")!.label).toBe("STOK UYARISI");
  });

  it("buildRackAlertPins rafın en kötü durumunu sayılı büyük pinle yukarı asar", () => {
    const model = buildSceneModel(demoLayout);
    const pins = buildRackAlertPins(bins, model.racks);
    expect(pins).toHaveLength(1);
    expect(pins[0].level).toBe("critical"); // critical, warning'i ezer
    expect(pins[0].label).toBe("2 KRİTİK"); // raftaki alert'li göz sayısı
    expect(pins[0].scale).toBeGreaterThan(1);
    // tıklanınca kritik gözü (101) hedefler, onun bağlamını taşır
    expect(pins[0].binId).toBe(101);
    expect(pins[0].sku).toBe("PLT-EUR");
    const rack = model.racks[0];
    expect(pins[0].tip[1]).toBeGreaterThan(rack.center[1] + rack.size[1] / 2);
  });

  it("ayak izi dışındaki gözler rafın pinini etkilemez", () => {
    const farBin = {
      ...bins[0],
      id: 999,
      center: [30, 1, 20] as [number, number, number],
      alert: "critical" as const,
    };
    const model = buildSceneModel(demoLayout);
    const cleanBins = bins.map((b) => ({ ...b, alert: null }));
    const pins = buildRackAlertPins([...cleanBins, farBin], model.racks);
    expect(pins).toHaveLength(0);
  });
});
