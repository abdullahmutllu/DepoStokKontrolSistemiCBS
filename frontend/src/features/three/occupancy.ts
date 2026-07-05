/** Occupancy → color bucket mapping. This scale is load-bearing: it encodes
 * real stock data in both the 3D scene and every list/report chip. */

export type OccupancyBucket = "empty" | "low" | "mid" | "high";

export const OCCUPANCY_COLORS: Record<OccupancyBucket, string> = {
  empty: "#3d475c",
  low: "#3fb970",
  mid: "#e0a93e",
  high: "#e25c4a",
};

export const HIGHLIGHT_COLOR = "#9dc1ff";
export const DIMMED_COLOR = "#232c42";

export function occupancyRatio(quantity: number, capacity: number | null): number {
  if (!capacity || capacity <= 0) return quantity > 0 ? 1 : 0;
  return quantity / capacity;
}

export function occupancyBucket(quantity: number, capacity: number | null): OccupancyBucket {
  if (quantity <= 0) return "empty";
  const ratio = occupancyRatio(quantity, capacity);
  if (ratio < 0.6) return "low";
  if (ratio <= 0.85) return "mid";
  return "high";
}

export function occupancyColor(quantity: number, capacity: number | null): string {
  return OCCUPANCY_COLORS[occupancyBucket(quantity, capacity)];
}

export const OCCUPANCY_LEGEND: { bucket: OccupancyBucket; label: string }[] = [
  { bucket: "empty", label: "Boş" },
  { bucket: "low", label: "%60 altı" },
  { bucket: "mid", label: "%60–85" },
  { bucket: "high", label: "%85 üstü" },
];

/* ── Movement heat (ABC): who gets touched, not who is full ────────────────── */

export type AbcBucket = "a" | "b" | "c" | "idle";

export const ABC_COLORS: Record<AbcBucket, string> = {
  a: "#e25c4a", // hot movers
  b: "#e0a93e",
  c: "#3fb970", // slow movers
  idle: "#3d475c",
};

/** Simple share-of-max ABC: A ≥ %50, B ≥ %20, C > 0, hareketsiz = idle. */
export function abcBucket(count: number, maxCount: number): AbcBucket {
  if (count <= 0 || maxCount <= 0) return "idle";
  const ratio = count / maxCount;
  if (ratio >= 0.5) return "a";
  if (ratio >= 0.2) return "b";
  return "c";
}

export const ABC_LEGEND: { bucket: AbcBucket; label: string }[] = [
  { bucket: "a", label: "A · yoğun" },
  { bucket: "b", label: "B · orta" },
  { bucket: "c", label: "C · seyrek" },
  { bucket: "idle", label: "Hareketsiz" },
];
