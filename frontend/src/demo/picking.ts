/** Demo pick-route solver: rectilinear walking over a front corridor,
 * mirroring the real backend's policy comparison (S-shape / largest-gap /
 * greedy+2-opt) at demo scale.
 */

import type { PickRoute, PickStop, PolicyRoute } from "@/types";
import { binQuantity, binStockRows, binsByWarehouse, warehouses } from "@/demo/data";

interface Pick {
  locationId: number;
  code: string;
  x: number; // bin center x
  y: number; // bin front y
  band: number;
}

const CORRIDOR_Y = 0.6;

function toPick(loc: { id: number; code: string; pos_x: number; pos_y: number; dim_w: number }): Pick {
  return {
    locationId: loc.id,
    code: loc.code,
    x: loc.pos_x + loc.dim_w / 2,
    y: loc.pos_y,
    band: Math.round(loc.pos_y * 10),
  };
}

/** Rectilinear path via the front corridor: walk x on the corridor, dip to the
 * bin, come back. Consecutive picks in the same band connect directly. */
function buildRoute(depot: { x: number; y: number }, order: Pick[]): { path: { x: number; y: number }[]; total: number } {
  const path: { x: number; y: number }[] = [{ x: depot.x, y: depot.y }];
  let cursor = { x: depot.x, y: depot.y, band: -1 };
  for (const pick of order) {
    if (cursor.band === pick.band) {
      path.push({ x: pick.x, y: pick.y });
    } else {
      if (cursor.y !== CORRIDOR_Y) path.push({ x: cursor.x, y: CORRIDOR_Y });
      path.push({ x: pick.x, y: CORRIDOR_Y });
      path.push({ x: pick.x, y: pick.y });
    }
    cursor = { x: pick.x, y: pick.y, band: pick.band };
  }
  if (cursor.y !== CORRIDOR_Y) path.push({ x: cursor.x, y: CORRIDOR_Y });
  path.push({ x: depot.x, y: depot.y });

  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
  }
  return { path, total };
}

function routeLength(depot: { x: number; y: number }, order: Pick[]): number {
  return buildRoute(depot, order).total;
}

function sShapeOrder(picks: Pick[]): Pick[] {
  const bands = [...new Set(picks.map((p) => p.band))].sort((a, b) => a - b);
  const out: Pick[] = [];
  bands.forEach((band, i) => {
    const inBand = picks.filter((p) => p.band === band).sort((a, b) => a.x - b.x);
    out.push(...(i % 2 === 0 ? inBand : inBand.reverse()));
  });
  return out;
}

function largestGapOrder(picks: Pick[]): Pick[] {
  const bands = [...new Set(picks.map((p) => p.band))].sort((a, b) => a - b);
  const out: Pick[] = [];
  for (const band of bands) {
    // enter/leave from the same end past the largest gap between picks
    const inBand = picks.filter((p) => p.band === band).sort((a, b) => a.x - b.x);
    let gapAt = 0;
    let gap = -1;
    for (let i = 1; i < inBand.length; i++) {
      const g = inBand[i].x - inBand[i - 1].x;
      if (g > gap) {
        gap = g;
        gapAt = i;
      }
    }
    out.push(...inBand.slice(0, gapAt), ...inBand.slice(gapAt).reverse());
  }
  return out;
}

function optimizedOrder(depot: { x: number; y: number }, picks: Pick[]): Pick[] {
  // greedy nearest neighbour on the corridor metric…
  const remaining = [...picks];
  const order: Pick[] = [];
  let cx = depot.x;
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    remaining.forEach((p, i) => {
      const d = Math.abs(p.x - cx) + Math.abs(p.y - CORRIDOR_Y);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const [next] = remaining.splice(best, 1);
    order.push(next);
    cx = next.x;
  }
  // …then hand-rolled 2-opt
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const candidate = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
        if (routeLength(depot, candidate) + 1e-9 < routeLength(depot, order)) {
          order.splice(0, order.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return order;
}

export function solvePickRoute(warehouseId: number, locationIds: number[]): PickRoute | { error: string } {
  const wh = warehouses.find((w) => w.id === warehouseId);
  const bins = binsByWarehouse.get(warehouseId) ?? [];
  const picks = locationIds
    .map((id) => bins.find((b) => b.id === id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    .map(toPick);
  if (!wh || picks.length < 2) {
    return { error: "Rota için bu depoda en az 2 geçerli göz gerekli." };
  }

  const depot = { x: wh.local_width / 2, y: 0.2 };
  const policies: [PolicyRoute["policy"], Pick[]][] = [
    ["s_shape", sShapeOrder(picks)],
    ["largest_gap", largestGapOrder(picks)],
    ["optimized", optimizedOrder(depot, picks)],
  ];

  const routes: PolicyRoute[] = policies.map(([policy, order]) => {
    const { path, total } = buildRoute(depot, order);
    const stops: PickStop[] = order.map((p, i) => {
      const row = binStockRows(p.locationId)[0];
      return {
        order: i + 1,
        location_id: p.locationId,
        code: p.code,
        x: p.x,
        y: p.y,
        product_sku: row?.sku ?? null,
        quantity: row ? Math.min(row.quantity, 5) : binQuantity(p.locationId) || null,
      };
    });
    return { policy, total_m: Math.round(total * 10) / 10, stops, path };
  });

  const best = routes.reduce((a, b) => (b.total_m < a.total_m ? b : a));
  return {
    warehouse_id: warehouseId,
    pick_count: picks.length,
    routes,
    best_policy: best.policy,
  };
}
