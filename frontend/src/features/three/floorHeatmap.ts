/** Zemin ısı haritası (hareket yoğunluğu) + rota üzerinde poz interpolasyonu.
 * Saf hesaplar — WebGL'siz test edilir; canvas'a boyama WarehouseScene'de.
 */

import type { BinInstance } from "@/features/three/sceneModel";

/* ── ısı ızgarası ─────────────────────────────────────────────────────────── */

/** metre başına 1 hücre; her göz movementCount'unu 2.5 m yarıçaplı gauss
 * düşüşüyle çevresine yayar. Dönen değerler 0-1'e normalize edilir. */
export function heatGrid(
  bins: BinInstance[],
  width: number,
  depth: number,
): number[][] {
  const w = Math.max(1, Math.ceil(width));
  const d = Math.max(1, Math.ceil(depth));
  const grid: number[][] = Array.from({ length: d }, () => new Array<number>(w).fill(0));
  const sigma = 2.5;
  const reach = Math.ceil(sigma * 2);

  for (const bin of bins) {
    if (bin.movementCount <= 0) continue;
    const bx = bin.center[0];
    const bz = bin.center[2];
    const x0 = Math.max(0, Math.floor(bx - reach));
    const x1 = Math.min(w - 1, Math.ceil(bx + reach));
    const z0 = Math.max(0, Math.floor(bz - reach));
    const z1 = Math.min(d - 1, Math.ceil(bz + reach));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const dist2 = (x + 0.5 - bx) ** 2 + (z + 0.5 - bz) ** 2;
        grid[z][x] += bin.movementCount * Math.exp(-dist2 / (2 * sigma * sigma));
      }
    }
  }

  let max = 0;
  for (const row of grid) for (const v of row) max = Math.max(max, v);
  if (max > 0) {
    for (const row of grid) {
      for (let x = 0; x < row.length; x++) row[x] /= max;
    }
  }
  return grid;
}

/** 0-1 yoğunluğu soğuk→sıcak renge çevirir (mavi → sarı → kırmızı). */
export function heatColor(t: number): [number, number, number] {
  const c = Math.min(1, Math.max(0, t));
  if (c < 0.5) {
    const k = c / 0.5; // mavi → sarı
    return [Math.round(40 + k * 200), Math.round(90 + k * 120), Math.round(200 - k * 140)];
  }
  const k = (c - 0.5) / 0.5; // sarı → kırmızı
  return [Math.round(240 - k * 14), Math.round(210 - k * 118), Math.round(60 - k * 14)];
}

/* ── rota pozu (forklift sürüşü) ─────────────────────────────────────────── */

export interface PathPose {
  position: [number, number, number]; // three (x, 0, z)
  rotationY: number; // hareket yönü
}

export function pathLength(path: { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
}

/** Rota başından `distance` metre ilerideki konum + bakış yönü.
 * distance toplamı aşarsa sona kenetlenir; negatifse başa. */
export function pathPoseAt(path: { x: number; y: number }[], distance: number): PathPose {
  if (path.length === 0) return { position: [0, 0, 0], rotationY: 0 };
  if (path.length === 1) return { position: [path[0].x, 0, path[0].y], rotationY: 0 };

  let remaining = Math.max(0, distance);
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1].x;
    const ay = path[i - 1].y;
    const dx = path[i].x - ax;
    const dy = path[i].y - ay;
    const seg = Math.hypot(dx, dy);
    if (seg < 1e-9) continue;
    if (remaining <= seg) {
      const t = remaining / seg;
      return {
        position: [ax + dx * t, 0, ay + dy * t],
        // three'de -z ileri; depo düzleminde y → z eşlendi
        rotationY: Math.atan2(dx, dy),
      };
    }
    remaining -= seg;
  }
  const last = path[path.length - 1];
  const prev = path[path.length - 2];
  return {
    position: [last.x, 0, last.y],
    rotationY: Math.atan2(last.x - prev.x, last.y - prev.y),
  };
}
