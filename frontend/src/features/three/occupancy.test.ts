import { describe, expect, it } from "vitest";
import {
  abcBucket,
  OCCUPANCY_COLORS,
  occupancyBucket,
  occupancyColor,
  occupancyRatio,
} from "@/features/three/occupancy";

describe("occupancyBucket", () => {
  it("maps zero quantity to empty regardless of capacity", () => {
    expect(occupancyBucket(0, 100)).toBe("empty");
    expect(occupancyBucket(0, null)).toBe("empty");
  });

  it("maps <60% to low", () => {
    expect(occupancyBucket(1, 100)).toBe("low");
    expect(occupancyBucket(59, 100)).toBe("low");
  });

  it("maps 60-85% to mid (inclusive upper bound)", () => {
    expect(occupancyBucket(60, 100)).toBe("mid");
    expect(occupancyBucket(85, 100)).toBe("mid");
  });

  it("maps >85% to high", () => {
    expect(occupancyBucket(86, 100)).toBe("high");
    expect(occupancyBucket(150, 100)).toBe("high");
  });

  it("treats capacity-less bins with stock as fully occupied", () => {
    expect(occupancyBucket(5, null)).toBe("high");
    expect(occupancyRatio(5, null)).toBe(1);
  });

  it("returns the matching scale color", () => {
    expect(occupancyColor(30, 100)).toBe(OCCUPANCY_COLORS.low);
    expect(occupancyColor(70, 100)).toBe(OCCUPANCY_COLORS.mid);
    expect(occupancyColor(90, 100)).toBe(OCCUPANCY_COLORS.high);
  });
});

describe("abcBucket", () => {
  it("hareketsiz gözler idle", () => {
    expect(abcBucket(0, 10)).toBe("idle");
    expect(abcBucket(5, 0)).toBe("idle");
  });

  it("maksimumun payına göre A/B/C sınıflar", () => {
    expect(abcBucket(10, 10)).toBe("a"); // %100
    expect(abcBucket(5, 10)).toBe("a"); // %50 sınırı dahil
    expect(abcBucket(4, 10)).toBe("b");
    expect(abcBucket(2, 10)).toBe("b"); // %20 sınırı dahil
    expect(abcBucket(1, 10)).toBe("c");
  });
});
