import { describe, expect, it } from "vitest";
import { heatColor, heatGrid, pathLength, pathPoseAt } from "@/features/three/floorHeatmap";
import { buildBinInstance } from "@/features/three/sceneModel";
import { demoLayout } from "@/test/mocks/handlers";

describe("heatGrid", () => {
  const bins = demoLayout.bins.map(buildBinInstance); // 101: 12 hareket, 103: 3

  it("en sıcak hücre en hareketli gözün üstünde ve 1'e normalize", () => {
    const grid = heatGrid(bins, 40, 25);
    expect(grid).toHaveLength(25);
    expect(grid[0]).toHaveLength(40);
    const hot = bins.find((b) => b.id === 101)!;
    const hotCell = grid[Math.floor(hot.center[2])][Math.floor(hot.center[0])];
    expect(hotCell).toBeCloseTo(1, 1);
    // uzak köşe soğuk
    expect(grid[24][39]).toBeLessThan(0.05);
  });

  it("hareket yoksa tüm ızgara sıfır", () => {
    const cold = bins.map((b) => ({ ...b, movementCount: 0 }));
    const grid = heatGrid(cold, 10, 10);
    expect(grid.flat().every((v) => v === 0)).toBe(true);
  });
});

describe("heatColor", () => {
  it("soğuk mavi, orta sarı, sıcak kırmızı tonlarına gider", () => {
    const [, , coldB] = heatColor(0);
    const [midR, midG] = heatColor(0.5);
    const [hotR, hotG] = heatColor(1);
    expect(coldB).toBeGreaterThan(150); // mavi baskın
    expect(midR).toBeGreaterThan(200);
    expect(midG).toBeGreaterThan(180); // sarı
    expect(hotR).toBeGreaterThan(200);
    expect(hotG).toBeLessThan(120); // kırmızı
  });
});

describe("pathPoseAt", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 5 },
  ];

  it("toplam uzunluk parça toplamı", () => {
    expect(pathLength(path)).toBeCloseTo(15);
  });

  it("ilk bacak ortasında doğru konum ve +x yönü", () => {
    const pose = pathPoseAt(path, 5);
    expect(pose.position[0]).toBeCloseTo(5);
    expect(pose.position[2]).toBeCloseTo(0);
    expect(pose.rotationY).toBeCloseTo(Math.PI / 2); // atan2(dx=1, dy=0)
  });

  it("ikinci bacakta +y yönüne döner", () => {
    const pose = pathPoseAt(path, 12);
    expect(pose.position[0]).toBeCloseTo(10);
    expect(pose.position[2]).toBeCloseTo(2);
    expect(pose.rotationY).toBeCloseTo(0); // atan2(0, 1)
  });

  it("mesafe aşımında sona kenetlenir", () => {
    const pose = pathPoseAt(path, 99);
    expect(pose.position).toEqual([10, 0, 5]);
  });
});
