/** Backend'in vrp / tracking / forecast servislerinin TARAYICI portu.
 *
 * Canlı araç takibi durumsuzdur: konum = f(plan, geçen_süre). Demo modunda
 * MSW WebSocket yakalayamadığı için frontend REST polling'e düşer; her GET
 * `position_at(plan, elapsed)`'ı yeniden hesaplar — böylece araçlar tarayıcıda
 * gerçekten hareket eder, sunucu ya da soket olmadan.
 */

import type { LatLng } from "@/types";

const R = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const dLat = la2 - la1;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ── VRP: Clarke-Wright savings + 2-opt ──────────────────────────────────── */

export interface VrpStop {
  id: number;
  lat: number;
  lng: number;
  demand: number;
}
export interface VrpRoute {
  stops: VrpStop[];
  distanceKm: number;
  load: number;
}

const d = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  haversineKm(a, b);

function twoOpt(depot: LatLng, stops: VrpStop[]): VrpStop[] {
  if (stops.length < 3) return stops;
  const len = (seq: VrpStop[]) => {
    let t = d(depot, seq[0]);
    for (let i = 1; i < seq.length; i++) t += d(seq[i - 1], seq[i]);
    return t + d(seq[seq.length - 1], depot);
  };
  let best = [...stops];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let j = i + 1; j < best.length; j++) {
        const cand = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
        if (len(cand) < len(best) - 1e-9) {
          best = cand;
          improved = true;
        }
      }
    }
  }
  return best;
}

export function solveVrp(
  depot: LatLng,
  stops: VrpStop[],
  vehicleCount: number,
  capacity: number,
): VrpRoute[] {
  if (stops.length === 0) return [];
  // her durak kendi rotası
  let routes = stops.map((s) => [s]);

  interface Saving {
    i: number;
    j: number;
    value: number;
  }
  const savings: Saving[] = [];
  for (let a = 0; a < stops.length; a++) {
    for (let b = a + 1; b < stops.length; b++) {
      savings.push({
        i: stops[a].id,
        j: stops[b].id,
        value: d(depot, stops[a]) + d(depot, stops[b]) - d(stops[a], stops[b]),
      });
    }
  }
  savings.sort((x, y) => y.value - x.value || x.i - y.i || x.j - y.j);

  const load = (r: VrpStop[]) => r.reduce((s, x) => s + x.demand, 0);
  const routeOf = (id: number) => routes.find((r) => r.some((s) => s.id === id));

  for (const { i, j } of savings) {
    const ri = routeOf(i);
    const rj = routeOf(j);
    if (!ri || !rj || ri === rj) continue;
    // i rota sonu, j rota başı olmalı
    if (ri[ri.length - 1].id !== i || rj[0].id !== j) continue;
    if (load(ri) + load(rj) > capacity) continue;
    const merged = [...ri, ...rj];
    routes = routes.filter((r) => r !== ri && r !== rj);
    routes.push(merged);
  }

  // vehicleCount'a zorla indir (en küçük yüklüleri kapasitesi yeten en yakına)
  while (routes.length > vehicleCount) {
    routes.sort((a, b) => load(a) - load(b));
    const small = routes.shift()!;
    let target: VrpStop[] | null = null;
    let bestGap = Infinity;
    for (const r of routes) {
      if (load(r) + load(small) > capacity) continue;
      const gap = d(r[r.length - 1], small[0]);
      if (gap < bestGap) {
        bestGap = gap;
        target = r;
      }
    }
    if (!target) {
      routes.push(small); // indirilemedi
      break;
    }
    target.push(...small);
  }

  return routes.map((r) => {
    const ordered = twoOpt(depot, r);
    let dist = d(depot, ordered[0]);
    for (let k = 1; k < ordered.length; k++) dist += d(ordered[k - 1], ordered[k]);
    dist += d(ordered[ordered.length - 1], depot);
    return { stops: ordered, distanceKm: Math.round(dist * 10) / 10, load: load(ordered) };
  });
}

/* ── Canlı takip motoru ──────────────────────────────────────────────────── */

export interface TrackStop {
  id: number;
  name: string;
  lat: number;
  lng: number;
  serviceMin: number;
}
interface Leg {
  from: LatLng;
  to: LatLng;
  distanceKm: number;
  speedKmh: number;
  travelMin: number;
  cumDepartMin: number;
  cumArriveMin: number;
}
export interface TrackPlan {
  depot: LatLng;
  stops: TrackStop[];
  legs: Leg[];
  totalKm: number;
  totalMin: number;
}

function frac(x: number): number {
  return x - Math.floor(x);
}
export function legSpeed(baseKmh: number, legIndex: number): number {
  const f = frac(Math.sin(legIndex * 12.9898) * 43758.5453);
  return baseKmh * (0.85 + 0.3 * f);
}

export function bearingDeg(a: LatLng, b: LatLng): number {
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

export function buildPlan(depot: LatLng, stops: TrackStop[], baseSpeedKmh = 65): TrackPlan {
  const points: LatLng[] = [depot, ...stops.map((s) => ({ lat: s.lat, lng: s.lng })), depot];
  const legs: Leg[] = [];
  let cum = 0;
  let totalKm = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const distanceKm = haversineKm(from, to);
    const speedKmh = legSpeed(baseSpeedKmh, i);
    const travelMin = (distanceKm / speedKmh) * 60;
    const cumDepartMin = cum;
    const cumArriveMin = cum + travelMin;
    legs.push({ from, to, distanceKm, speedKmh, travelMin, cumDepartMin, cumArriveMin });
    totalKm += distanceKm;
    // varıştan sonra durak servisi (son bacak depoya dönüş, servis yok)
    cum = cumArriveMin + (i < stops.length ? stops[i].serviceMin : 0);
  }
  return { depot, stops, legs, totalKm, totalMin: cum };
}

export interface LivePose {
  status: "pending" | "en_route" | "at_stop" | "completed";
  position: LatLng;
  heading_deg: number;
  speed_kmh: number;
  progress_percent: number;
  completed_stops: number;
  current_stop: string | null;
  next_stop: string | null;
  next_stop_eta_min: number | null;
  next_stop_remaining_km: number | null;
  eta_return_min: number;
}

export function positionAt(plan: TrackPlan, elapsedMin: number): LivePose {
  const { legs, stops, depot, totalMin } = plan;
  const progress = Math.max(0, Math.min(100, (elapsedMin / Math.max(totalMin, 1e-9)) * 100));
  const base = {
    heading_deg: 0,
    speed_kmh: 0,
    progress_percent: Math.round(progress * 10) / 10,
    current_stop: null as string | null,
    next_stop: null as string | null,
    next_stop_eta_min: null as number | null,
    next_stop_remaining_km: null as number | null,
  };

  if (elapsedMin < 0) {
    return {
      ...base,
      status: "pending",
      position: depot,
      completed_stops: 0,
      next_stop: stops[0]?.name ?? null,
      next_stop_eta_min: legs[0]?.travelMin ?? null,
      next_stop_remaining_km: legs[0]?.distanceKm ?? null,
      eta_return_min: totalMin,
    };
  }
  if (elapsedMin >= totalMin) {
    return {
      ...base,
      status: "completed",
      position: depot,
      completed_stops: stops.length,
      progress_percent: 100,
      eta_return_min: 0,
    };
  }

  // servisi bitmiş durak sayısı
  let completed = 0;
  for (let i = 0; i < stops.length; i++) {
    const departFromStop = legs[i].cumArriveMin + stops[i].serviceMin;
    if (elapsedMin >= departFromStop) completed++;
  }

  // hangi bacaktayız / hangi durakta servisteyiz?
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (elapsedMin < leg.cumArriveMin) {
      // bu bacakta yolda
      const t = (elapsedMin - leg.cumDepartMin) / Math.max(leg.travelMin, 1e-9);
      const position = {
        lat: leg.from.lat + (leg.to.lat - leg.from.lat) * t,
        lng: leg.from.lng + (leg.to.lng - leg.from.lng) * t,
      };
      const targetStop = i < stops.length ? stops[i] : null;
      return {
        status: "en_route",
        position,
        heading_deg: Math.round(bearingDeg(leg.from, leg.to) * 10) / 10,
        speed_kmh: Math.round(leg.speedKmh * 10) / 10,
        progress_percent: base.progress_percent,
        completed_stops: completed,
        current_stop: null,
        next_stop: targetStop?.name ?? null,
        next_stop_eta_min: targetStop ? Math.round((leg.cumArriveMin - elapsedMin) * 10) / 10 : null,
        next_stop_remaining_km: targetStop
          ? Math.round(leg.distanceKm * (1 - t) * 10) / 10
          : null,
        eta_return_min: Math.round((totalMin - elapsedMin) * 10) / 10,
      };
    }
    // bu durakta servis penceresi?
    if (i < stops.length) {
      const departFromStop = leg.cumArriveMin + stops[i].serviceMin;
      if (elapsedMin < departFromStop) {
        const nextStop = i + 1 < stops.length ? stops[i + 1] : null;
        return {
          status: "at_stop",
          position: { lat: stops[i].lat, lng: stops[i].lng },
          heading_deg: 0,
          speed_kmh: 0,
          progress_percent: base.progress_percent,
          completed_stops: completed,
          current_stop: stops[i].name,
          next_stop: nextStop?.name ?? null,
          next_stop_eta_min: nextStop
            ? Math.round((departFromStop + legs[i + 1].travelMin - elapsedMin) * 10) / 10
            : null,
          next_stop_remaining_km: nextStop ? Math.round(legs[i + 1].distanceKm * 10) / 10 : null,
          eta_return_min: Math.round((totalMin - elapsedMin) * 10) / 10,
        };
      }
    }
  }

  // depoya dönüş bacağı (son leg)
  return {
    ...base,
    status: "en_route",
    position: depot,
    completed_stops: stops.length,
    eta_return_min: Math.round((totalMin - elapsedMin) * 10) / 10,
  };
}

/* ── Holt tahmini ────────────────────────────────────────────────────────── */

export function holtForecast(series: number[], horizon: number, alpha = 0.35, beta = 0.15): number[] {
  if (horizon <= 0) return [];
  if (series.length < 2) {
    const last = series.length ? series[series.length - 1] : 0;
    return new Array(horizon).fill(Math.max(0, last));
  }
  let level = series[0];
  let trend = series[1] - series[0];
  for (let i = 1; i < series.length; i++) {
    const prevLevel = level;
    level = alpha * series[i] + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }
  const out: number[] = [];
  for (let h = 1; h <= horizon; h++) out.push(Math.max(0, level + h * trend));
  return out;
}

export function demandStats(series: number[]): { avg: number; std: number } {
  if (series.length === 0) return { avg: 0, std: 0 };
  const avg = series.reduce((s, v) => s + v, 0) / series.length;
  if (series.length < 2) return { avg, std: 0 };
  const variance = series.reduce((s, v) => s + (v - avg) ** 2, 0) / series.length;
  return { avg, std: Math.sqrt(variance) };
}

export function reorderPoint(series: number[], leadTimeDays = 3, z = 1.65): number {
  const { avg, std } = demandStats(series);
  const L = Math.max(0, leadTimeDays);
  return Math.max(0, Math.ceil(avg * L + z * std * Math.sqrt(L)));
}

export function daysUntilStockout(currentStock: number, forecast: number[]): number | null {
  let cum = 0;
  for (let i = 0; i < forecast.length; i++) {
    cum += forecast[i];
    if (cum > currentStock) return i + 1;
  }
  return null;
}

/* ── Voronoi (yarım-düzlem kırpma) — senaryo/atama için ─────────────────── */

export function nearest<T extends { location: LatLng }>(pt: LatLng, options: T[]): T {
  return options.reduce((best, o) =>
    haversineKm(pt, o.location) < haversineKm(pt, best.location) ? o : best,
  );
}
