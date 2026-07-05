/** Small geospatial helpers for the in-browser demo backend.
 * Lightweight stand-ins for what PostGIS does on the real server.
 */

import type { LatLng } from "@/types";

export const EARTH_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** ~circle on the sphere as a lat/lng ring (n-gon). */
export function circleRing(center: LatLng, radiusKm: number, n = 24): LatLng[] {
  const ring: LatLng[] = [];
  const latR = radiusKm / 111.32;
  const lngR = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    ring.push({ lat: center.lat + latR * Math.sin(t), lng: center.lng + lngR * Math.cos(t) });
  }
  return ring;
}

/** Ray-cast point-in-polygon on lat/lng. */
export function pointInRing(p: LatLng, ring: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.lng > p.lng !== b.lng > p.lng &&
      p.lat < ((b.lat - a.lat) * (p.lng - a.lng)) / (b.lng - a.lng) + a.lat
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Rough geodesic area (m²) of a lat/lng ring via planar shoelace at mid-latitude. */
export function ringAreaM2(ring: LatLng[]): number {
  if (ring.length < 3) return 0;
  const midLat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const mPerLat = 111_320;
  const mPerLng = 111_320 * Math.cos((midLat * Math.PI) / 180);
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng * mPerLng;
    const yi = ring[i].lat * mPerLat;
    const xj = ring[j].lng * mPerLng;
    const yj = ring[j].lat * mPerLat;
    area += xj * yi - xi * yj;
  }
  return Math.abs(area / 2);
}

/* ── Voronoi via half-plane clipping (fine for a handful of sites) ────────── */

type Pt = { x: number; y: number };

function clipHalfPlane(poly: Pt[], a: Pt, b: Pt): Pt[] {
  // keep points closer to `a` than to `b` (perpendicular bisector clip)
  const out: Pt[] = [];
  const side = (p: Pt) =>
    (p.x - a.x) ** 2 + (p.y - a.y) ** 2 - ((p.x - b.x) ** 2 + (p.y - b.y) ** 2);
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if (sp * sq < 0) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return out;
}

/** Voronoi cells for sites, clipped to the Turkey envelope. lng→x, lat→y. */
export function voronoiCells(sites: LatLng[]): LatLng[][] {
  const bbox: Pt[] = [
    { x: 24, y: 34 },
    { x: 46, y: 34 },
    { x: 46, y: 43.5 },
    { x: 24, y: 43.5 },
  ];
  return sites.map((site, i) => {
    let cell = bbox;
    const a = { x: site.lng, y: site.lat };
    sites.forEach((other, j) => {
      if (i === j || cell.length === 0) return;
      cell = clipHalfPlane(cell, a, { x: other.lng, y: other.lat });
    });
    return cell.map((p) => ({ lat: p.y, lng: p.x }));
  });
}

/* ── Weighted k-means (deterministic) on lat/lng, lng scaled by cos(midLat) ── */

export function weightedKMeans(
  points: { location: LatLng; weight: number }[],
  k: number,
): { centers: LatLng[]; assignment: number[] } {
  const midLat = points.reduce((s, p) => s + p.location.lat, 0) / points.length;
  const sx = Math.cos((midLat * Math.PI) / 180);
  const px = points.map((p) => ({ x: p.location.lng * sx, y: p.location.lat, w: p.weight }));

  // deterministic seeds: heaviest distinct points
  const seeds = [...px]
    .map((p, i) => ({ ...p, i }))
    .sort((a, b) => b.w - a.w)
    .filter(
      (p, idx, arr) =>
        arr.findIndex((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6) === idx,
    )
    .slice(0, k);
  let centers = seeds.map((s) => ({ x: s.x, y: s.y }));

  let assignment = new Array(px.length).fill(0);
  for (let iter = 0; iter < 40; iter++) {
    assignment = px.map((p) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, ci) => {
        const d = (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = ci;
        }
      });
      return best;
    });
    const next = centers.map((c, ci) => {
      let wx = 0;
      let wy = 0;
      let w = 0;
      px.forEach((p, pi) => {
        if (assignment[pi] !== ci) return;
        wx += p.x * p.w;
        wy += p.y * p.w;
        w += p.w;
      });
      return w > 0 ? { x: wx / w, y: wy / w } : c;
    });
    const moved = next.some((c, ci) => Math.hypot(c.x - centers[ci].x, c.y - centers[ci].y) > 1e-7);
    centers = next;
    if (!moved) break;
  }
  return { centers: centers.map((c) => ({ lat: c.y, lng: c.x / sx })), assignment };
}
