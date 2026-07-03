import { describe, expect, it } from "vitest";
import {
  buildRackFrames,
  buildSceneModel,
  buildWalls,
  buildZoneMarkings,
  cameraPresets,
  sceneHeight,
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
