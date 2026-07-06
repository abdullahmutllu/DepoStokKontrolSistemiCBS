/** MSW handlers: the whole REST API, served from the browser.
 * Response shapes mirror the FastAPI backend 1:1 (including the error
 * envelope), so the UI cannot tell the difference.
 */

import { http, HttpResponse } from "msw";
import type {
  AskResponse,
  Coverage,
  LatLng,
  LowStockRow,
  MovementHistoryPoint,
  MoverRow,
  Page,
  Product,
  Region,
} from "@/types";
import {
  addLayout,
  binQuantity,
  binStockRows,
  binsByWarehouse,
  customers,
  dailyOutflow,
  DEMO_TOKEN,
  demoUser,
  layout3d,
  locationById,
  locations,
  movements,
  nextNotificationId,
  nextOrderId,
  nextProductId,
  nextRegionId,
  nextShipmentId,
  nextWarehouseId,
  notifications,
  orders,
  productById,
  productTotal,
  products,
  recordMovement,
  regions,
  shipments,
  stock,
  warehouses,
  type DemoShipment,
} from "@/demo/data";
import {
  circleRing,
  haversineKm,
  pointInRing,
  ringAreaM2,
  voronoiCells,
  weightedKMeans,
} from "@/demo/geo";
import { solvePickRoute } from "@/demo/picking";
import {
  buildPlan,
  daysUntilStockout,
  demandStats,
  holtForecast,
  positionAt,
  reorderPoint,
  solveVrp,
  type TrackStop,
  type VrpStop,
} from "@/demo/logistics";

const SERVICE_MIN = 12;
const COVERAGE_LIMIT_KM = 50;

const nearestWh = (pt: LatLng) =>
  warehouses.reduce((best, w) =>
    haversineKm(pt, w.location) < haversineKm(pt, best.location) ? w : best,
  );

function planOf(s: DemoShipment) {
  return buildPlan(
    s.depot,
    s.stops.map(
      (st): TrackStop => ({
        id: st.customer_id,
        name: st.name,
        lat: st.lat,
        lng: st.lng,
        serviceMin: st.service_min,
      }),
    ),
    s.base_speed_kmh,
  );
}

function shipmentOut(s: DemoShipment) {
  const plan = planOf(s);
  const elapsed = Math.max(-1, ((Date.now() - s.depart_at_ms) / 60000) * s.time_scale);
  const live = positionAt(plan, elapsed);
  const route = [s.depot, ...s.stops.map((st) => ({ lat: st.lat, lng: st.lng })), s.depot];
  return {
    id: s.id,
    warehouse_id: s.warehouse_id,
    vehicle_name: s.vehicle_name,
    total_km: Math.round(plan.totalKm * 10) / 10,
    total_min: Math.round(plan.totalMin * 10) / 10,
    time_scale: s.time_scale,
    depart_at: new Date(s.depart_at_ms).toISOString(),
    stop_count: s.stops.length,
    live: { ...live, elapsed_sim_min: Math.round(Math.max(0, elapsed) * 10) / 10 },
    route,
  };
}

const err = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message, details: null } }, { status });

const page = <T,>(items: T[], p = 1, size = 20): Page<T> => ({
  items: items.slice((p - 1) * size, p * size),
  total: items.length,
  page: p,
  page_size: size,
});

const num = (v: string | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function warehouseListItem(wh: (typeof warehouses)[number]) {
  const bins = binsByWarehouse.get(wh.id) ?? [];
  const used = bins.filter((b) => binQuantity(b.id) > 0);
  const total = bins.reduce((s, b) => s + binQuantity(b.id), 0);
  return {
    ...wh,
    location_count: locations.filter((l) => l.warehouse_id === wh.id).length,
    bin_count: bins.length,
    product_count: new Set(
      [...stock.keys()]
        .filter((k) => bins.some((b) => k.endsWith(`:${b.id}`)) && (stock.get(k) ?? 0) > 0)
        .map((k) => k.split(":")[0]),
    ).size,
    total_quantity: total,
    occupancy_percent: bins.length ? Math.round((used.length / bins.length) * 1000) / 10 : null,
  };
}

function productListItem(p: Product): Product {
  const total = productTotal(p.id);
  return {
    ...p,
    total_quantity: total,
    is_low_stock: p.min_stock_threshold > 0 && total <= p.min_stock_threshold,
  };
}

const nearestWarehouse = (pt: LatLng) =>
  warehouses.reduce((best, wh) =>
    haversineKm(pt, wh.location) < haversineKm(pt, best.location) ? wh : best,
  );

export const handlers = [
  /* ── auth ─────────────────────────────────────────────────────────────── */
  http.post("*/api/v1/auth/login", async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return err(401, "UNAUTHORIZED", "E-posta veya şifre hatalı");
    }
    return HttpResponse.json({
      access_token: DEMO_TOKEN,
      token_type: "bearer",
      user: { ...demoUser, email: body.email },
    });
  }),
  http.post("*/api/v1/auth/register", async ({ request }) => {
    const body = (await request.json()) as { email?: string };
    return HttpResponse.json({
      access_token: DEMO_TOKEN,
      token_type: "bearer",
      user: { ...demoUser, email: body.email ?? demoUser.email },
    });
  }),
  http.get("*/api/v1/auth/me", () => HttpResponse.json(demoUser)),

  /* ── warehouses & locations ───────────────────────────────────────────── */
  http.get("*/api/v1/warehouses", () => HttpResponse.json(warehouses.map(warehouseListItem))),
  http.post("*/api/v1/warehouses", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const wh = {
      id: nextWarehouseId(),
      name: String(body.name ?? "Yeni Depo"),
      address: (body.address as string) ?? null,
      location: (body.location as LatLng) ?? { lat: 39.0, lng: 35.0 },
      footprint: null,
      local_width: Number(body.local_width ?? 30),
      local_depth: Number(body.local_depth ?? 20),
      created_at: new Date().toISOString(),
    };
    warehouses.push(wh);
    return HttpResponse.json(warehouseListItem(wh), { status: 201 });
  }),
  http.get("*/api/v1/warehouses/:id", ({ params }) => {
    const wh = warehouses.find((w) => w.id === Number(params.id));
    return wh ? HttpResponse.json(warehouseListItem(wh)) : err(404, "NOT_FOUND", "Depo bulunamadı");
  }),
  http.patch("*/api/v1/warehouses/:id", async ({ params, request }) => {
    const wh = warehouses.find((w) => w.id === Number(params.id));
    if (!wh) return err(404, "NOT_FOUND", "Depo bulunamadı");
    Object.assign(wh, (await request.json()) as Partial<typeof wh>);
    return HttpResponse.json(warehouseListItem(wh));
  }),
  http.delete("*/api/v1/warehouses/:id", ({ params }) => {
    const idx = warehouses.findIndex((w) => w.id === Number(params.id));
    if (idx < 0) return err(404, "NOT_FOUND", "Depo bulunamadı");
    warehouses.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get("*/api/v1/warehouses/:id/locations", ({ params, request }) => {
    const type = new URL(request.url).searchParams.get("type");
    let rows = locations.filter((l) => l.warehouse_id === Number(params.id));
    if (type) rows = rows.filter((l) => l.type === type);
    return HttpResponse.json([...rows].sort((a, b) => a.code.localeCompare(b.code)));
  }),
  http.get("*/api/v1/warehouses/:id/layout-3d", ({ params }) => {
    const wh = warehouses.find((w) => w.id === Number(params.id));
    return wh ? HttpResponse.json(layout3d(wh.id)) : err(404, "NOT_FOUND", "Depo bulunamadı");
  }),
  http.post("*/api/v1/warehouses/:id/layout/generate", async ({ params, request }) => {
    const body = (await request.json()) as {
      racks: { shelf_count: number; bins_per_shelf: number }[];
    };
    const rows = Math.min(6, Math.max(1, body.racks.length));
    const shelves = body.racks[0]?.shelf_count ?? 3;
    const bins = body.racks[0]?.bins_per_shelf ?? 6;
    const created = addLayout(Number(params.id), rows, shelves, bins);
    return HttpResponse.json(
      {
        zone_id: created[0]?.parent_id ?? 0,
        zone_code: "Z1",
        created_aisles: rows,
        created_racks: rows,
        created_shelves: rows * shelves,
        created_bins: created.length,
        sample_codes: created.slice(0, 3).map((b) => b.code),
      },
      { status: 201 },
    );
  }),

  /* ── DXF (canned but coherent preview) ────────────────────────────────── */
  http.post("*/api/v1/warehouses/:id/dxf/parse", () =>
    HttpResponse.json({
      units: "mm",
      scale_applied: 0.001,
      bounds_w: 30,
      bounds_d: 20,
      racks: [
        { x: 2, y: 2, w: 8, d: 1.2, rotation: 0 },
        { x: 2, y: 7, w: 8, d: 1.2, rotation: 0 },
      ],
      zones: [{ x: 1, y: 1, w: 12, d: 10, rotation: 0 }],
      aisles: [{ x: 2, y: 3.5, w: 8, d: 3, rotation: 0 }],
      walls: [{ x1: 0, y1: 0, x2: 30, y2: 0 }],
      warnings: ["Demo modu: örnek DXF önizlemesi gösteriliyor."],
    }),
  ),
  http.post("*/api/v1/warehouses/:id/dxf/generate", async ({ params, request }) => {
    const body = (await request.json()) as { shelf_count: number; bins_per_shelf: number };
    const created = addLayout(Number(params.id), 2, body.shelf_count, body.bins_per_shelf);
    return HttpResponse.json({
      zone_id: created[0]?.parent_id ?? 0,
      zone_code: "Z1",
      created_aisles: 2,
      created_racks: 2,
      created_shelves: 2 * body.shelf_count,
      created_bins: created.length,
      sample_codes: created.slice(0, 3).map((b) => b.code),
    });
  }),

  http.get("*/api/v1/locations/:id", ({ params }) => {
    const loc = locationById(Number(params.id));
    if (!loc) return err(404, "NOT_FOUND", "Lokasyon bulunamadı");
    const stockRows = binStockRows(loc.id);
    return HttpResponse.json({
      ...loc,
      stock: stockRows,
      total_quantity: stockRows.reduce((s, r) => s + r.quantity, 0),
    });
  }),

  /* ── products ─────────────────────────────────────────────────────────── */
  http.get("*/api/v1/products", ({ request }) => {
    const q = new URL(request.url).searchParams;
    let rows = products.map(productListItem);
    const search = q.get("search")?.toLowerCase();
    if (search) {
      rows = rows.filter(
        (p) =>
          p.sku.toLowerCase().includes(search) ||
          p.name.toLowerCase().includes(search) ||
          (p.barcode ?? "").includes(search),
      );
    }
    if (q.get("low_stock") === "true") rows = rows.filter((p) => p.is_low_stock);
    return HttpResponse.json(page(rows, num(q.get("page"), 1), num(q.get("page_size"), 20)));
  }),
  http.post("*/api/v1/products", async ({ request }) => {
    const body = (await request.json()) as Partial<Product> & { sku: string; name: string };
    const product: Product = {
      id: nextProductId(),
      sku: body.sku,
      name: body.name,
      description: body.description ?? null,
      unit: body.unit ?? "adet",
      barcode: body.barcode ?? null,
      dim_w: body.dim_w ?? null,
      dim_d: body.dim_d ?? null,
      dim_h: body.dim_h ?? null,
      min_stock_threshold: body.min_stock_threshold ?? 0,
      image_url: null,
      created_at: new Date().toISOString(),
    };
    products.push(product);
    return HttpResponse.json(productListItem(product), { status: 201 });
  }),
  http.patch("*/api/v1/products/:id", async ({ params, request }) => {
    const product = products.find((p) => p.id === Number(params.id));
    if (!product) return err(404, "NOT_FOUND", "Ürün bulunamadı");
    Object.assign(product, (await request.json()) as Partial<Product>);
    return HttpResponse.json(productListItem(product));
  }),
  http.delete("*/api/v1/products/:id", ({ params }) => {
    const idx = products.findIndex((p) => p.id === Number(params.id));
    if (idx < 0) return err(404, "NOT_FOUND", "Ürün bulunamadı");
    products.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post("*/api/v1/products/import-csv", () =>
    HttpResponse.json({ created: 3, updated: 1, errors: [] }),
  ),

  /* ── stock operations (stateful) ──────────────────────────────────────── */
  http.post("*/api/v1/stock/receive", async ({ request }) => {
    const b = (await request.json()) as { product_id: number; location_id: number; quantity: number; note?: string };
    if (b.quantity <= 0) return err(422, "VALIDATION", "Miktar pozitif olmalı");
    if (!locationById(b.location_id)) return err(404, "NOT_FOUND", "Göz bulunamadı");
    const key = `${b.product_id}:${b.location_id}`;
    stock.set(key, (stock.get(key) ?? 0) + b.quantity);
    recordMovement("receive", b.product_id, null, b.location_id, b.quantity, b.note ?? null);
    return HttpResponse.json({
      id: 1, product_id: b.product_id, location_id: b.location_id,
      quantity: stock.get(key), updated_at: new Date().toISOString(),
    });
  }),
  http.post("*/api/v1/stock/pick", async ({ request }) => {
    const b = (await request.json()) as { product_id: number; location_id: number; quantity: number; note?: string };
    const key = `${b.product_id}:${b.location_id}`;
    const current = stock.get(key) ?? 0;
    if (b.quantity <= 0) return err(422, "VALIDATION", "Miktar pozitif olmalı");
    if (current < b.quantity) {
      return err(422, "INSUFFICIENT_STOCK", `Yetersiz stok: gözde ${current} adet var`);
    }
    stock.set(key, current - b.quantity);
    recordMovement("pick", b.product_id, b.location_id, null, b.quantity, b.note ?? null);
    return HttpResponse.json({
      id: 1, product_id: b.product_id, location_id: b.location_id,
      quantity: current - b.quantity, updated_at: new Date().toISOString(),
    });
  }),
  http.post("*/api/v1/stock/transfer", async ({ request }) => {
    const b = (await request.json()) as {
      product_id: number; from_location_id: number; to_location_id: number; quantity: number; note?: string;
    };
    const fromKey = `${b.product_id}:${b.from_location_id}`;
    const toKey = `${b.product_id}:${b.to_location_id}`;
    const available = stock.get(fromKey) ?? 0;
    if (b.quantity <= 0) return err(422, "VALIDATION", "Miktar pozitif olmalı");
    if (available < b.quantity) {
      return err(422, "INSUFFICIENT_STOCK", `Yetersiz stok: kaynak gözde ${available} adet var`);
    }
    stock.set(fromKey, available - b.quantity);
    stock.set(toKey, (stock.get(toKey) ?? 0) + b.quantity);
    recordMovement("transfer", b.product_id, b.from_location_id, b.to_location_id, b.quantity, b.note ?? null);
    const now = new Date().toISOString();
    return HttpResponse.json([
      { id: 1, product_id: b.product_id, location_id: b.from_location_id, quantity: stock.get(fromKey), updated_at: now },
      { id: 2, product_id: b.product_id, location_id: b.to_location_id, quantity: stock.get(toKey), updated_at: now },
    ]);
  }),
  http.post("*/api/v1/stock/adjust", async ({ request }) => {
    const b = (await request.json()) as {
      product_id: number; location_id: number; new_quantity: number; type?: "adjust" | "count"; note?: string;
    };
    if (b.new_quantity < 0) return err(422, "VALIDATION", "Miktar negatif olamaz");
    const key = `${b.product_id}:${b.location_id}`;
    const before = stock.get(key) ?? 0;
    stock.set(key, b.new_quantity);
    recordMovement(b.type ?? "adjust", b.product_id, b.location_id, null, Math.abs(b.new_quantity - before), b.note ?? null);
    return HttpResponse.json({
      id: 1, product_id: b.product_id, location_id: b.location_id,
      quantity: b.new_quantity, updated_at: new Date().toISOString(),
    });
  }),
  http.get("*/api/v1/stock/movements", ({ request }) => {
    const q = new URL(request.url).searchParams;
    let rows = movements;
    const productId = q.get("product_id");
    if (productId) rows = rows.filter((m) => m.product_id === Number(productId));
    const type = q.get("type");
    if (type) rows = rows.filter((m) => m.type === type);
    const whId = q.get("warehouse_id");
    if (whId) {
      const binIds = new Set((binsByWarehouse.get(Number(whId)) ?? []).map((b) => b.id));
      rows = rows.filter(
        (m) =>
          (m.from_location_id && binIds.has(m.from_location_id)) ||
          (m.to_location_id && binIds.has(m.to_location_id)),
      );
    }
    return HttpResponse.json(page(rows, num(q.get("page"), 1), num(q.get("page_size"), 20)));
  }),
  http.get("*/api/v1/stock/find-product", ({ request }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase();
    if (!q) return HttpResponse.json([]);
    const matched = products.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.barcode ?? "").includes(q),
    );
    const rows: { location_id: number; code: string; warehouse_id: number; warehouse_name: string; quantity: number }[] = [];
    for (const p of matched) {
      for (const [key, qty] of stock) {
        if (!key.startsWith(`${p.id}:`) || qty <= 0) continue;
        const loc = locationById(Number(key.split(":")[1]));
        if (!loc) continue;
        const wh = warehouses.find((w) => w.id === loc.warehouse_id)!;
        rows.push({
          location_id: loc.id, code: loc.code,
          warehouse_id: wh.id, warehouse_name: wh.name, quantity: qty,
        });
      }
    }
    return HttpResponse.json(rows.sort((a, b) => b.quantity - a.quantity).slice(0, 30));
  }),

  /* ── reports ──────────────────────────────────────────────────────────── */
  http.get("*/api/v1/reports/warehouse-summaries", () =>
    HttpResponse.json(
      warehouses.map((wh) => {
        const bins = binsByWarehouse.get(wh.id) ?? [];
        const used = bins.filter((b) => binQuantity(b.id) > 0).length;
        return {
          warehouse_id: wh.id,
          warehouse_name: wh.name,
          zone_count: locations.filter((l) => l.warehouse_id === wh.id && l.type === "zone").length,
          rack_count: locations.filter((l) => l.warehouse_id === wh.id && l.type === "rack").length,
          bin_count: bins.length,
          used_bin_count: used,
          total_quantity: bins.reduce((s, b) => s + binQuantity(b.id), 0),
          occupancy_percent: bins.length ? Math.round((used / bins.length) * 1000) / 10 : 0,
        };
      }),
    ),
  ),
  http.get("*/api/v1/reports/stock-by-location", ({ request }) => {
    const q = new URL(request.url).searchParams;
    const whId = Number(q.get("warehouse_id"));
    const groupType = q.get("group_type") ?? "zone";
    const groups = locations.filter((l) => l.warehouse_id === whId && l.type === groupType);
    const bins = binsByWarehouse.get(whId) ?? [];
    return HttpResponse.json(
      groups.map((g) => {
        const groupBins = bins.filter((b) => b.code.startsWith(`${g.code}-`) || g.type === "zone");
        const productIds = new Set<string>();
        let total = 0;
        for (const b of groupBins) {
          for (const [key, qty] of stock) {
            if (!key.endsWith(`:${b.id}`) || qty <= 0) continue;
            productIds.add(key.split(":")[0]);
            total += qty;
          }
        }
        return {
          location_id: g.id, code: g.code, type: g.type,
          total_quantity: total, product_count: productIds.size,
        };
      }),
    );
  }),
  http.get("*/api/v1/reports/occupancy", ({ request }) => {
    const whId = Number(new URL(request.url).searchParams.get("warehouse_id"));
    const bins = binsByWarehouse.get(whId) ?? [];
    return HttpResponse.json(
      bins
        .map((b) => {
          const qty = binQuantity(b.id);
          return {
            location_id: b.id, code: b.code, type: "bin",
            capacity: b.capacity ?? 0, quantity: qty,
            occupancy_percent: b.capacity ? Math.round((qty / b.capacity) * 1000) / 10 : 0,
          };
        })
        .filter((r) => r.quantity > 0)
        .sort((a, b) => b.occupancy_percent - a.occupancy_percent),
    );
  }),
  http.get("*/api/v1/reports/low-stock", () => {
    const rows: LowStockRow[] = products
      .filter((p) => p.min_stock_threshold > 0)
      .map((p) => ({
        product_id: p.id, sku: p.sku, name: p.name, unit: p.unit,
        min_stock_threshold: p.min_stock_threshold, total_quantity: productTotal(p.id),
      }))
      .filter((r) => r.total_quantity <= r.min_stock_threshold);
    return HttpResponse.json(rows);
  }),
  http.get("*/api/v1/reports/top-movers", ({ request }) => {
    const q = new URL(request.url).searchParams;
    const days = num(q.get("days"), 7);
    const limit = num(q.get("limit"), 10);
    const since = Date.now() - days * 86_400_000;
    const byProduct = new Map<number, MoverRow>();
    for (const m of movements) {
      if (new Date(m.created_at).getTime() < since) continue;
      const row = byProduct.get(m.product_id) ?? {
        product_id: m.product_id, sku: m.product_sku, name: m.product_name,
        movement_count: 0, total_moved: 0,
      };
      row.movement_count += 1;
      row.total_moved += m.quantity;
      byProduct.set(m.product_id, row);
    }
    const asc = q.get("ascending") === "true";
    const rows = [...byProduct.values()].sort((a, b) =>
      asc ? a.movement_count - b.movement_count : b.movement_count - a.movement_count,
    );
    return HttpResponse.json(rows.slice(0, limit));
  }),
  http.get("*/api/v1/reports/movement-history", ({ request }) => {
    const days = num(new URL(request.url).searchParams.get("days"), 14);
    const points: MovementHistoryPoint[] = [];
    for (let d = days - 1; d >= 0; d--) {
      const dayStart = new Date(Date.now() - d * 86_400_000);
      const dayKey = dayStart.toISOString().slice(0, 10);
      const point: MovementHistoryPoint = { day: dayKey, receive: 0, pick: 0, transfer: 0, adjust: 0 };
      for (const m of movements) {
        if (!m.created_at.startsWith(dayKey)) continue;
        if (m.type === "receive") point.receive += m.quantity;
        else if (m.type === "pick") point.pick += m.quantity;
        else if (m.type === "transfer") point.transfer += m.quantity;
        else point.adjust += m.quantity;
      }
      points.push(point);
    }
    return HttpResponse.json(points);
  }),

  /* ── notifications ────────────────────────────────────────────────────── */
  http.get("*/api/v1/notifications", ({ request }) => {
    const q = new URL(request.url).searchParams;
    let rows = notifications;
    if (q.get("unread_only") === "true") rows = rows.filter((n) => !n.read);
    return HttpResponse.json(page(rows, num(q.get("page"), 1), 20));
  }),
  http.get("*/api/v1/notifications/unread-count", () =>
    HttpResponse.json({ unread: notifications.filter((n) => !n.read).length }),
  ),
  http.post("*/api/v1/notifications/mark-all-read", () => {
    notifications.forEach((n) => {
      n.read = true;
    });
    return new HttpResponse(null, { status: 204 });
  }),
  http.post("*/api/v1/notifications/run-low-stock-check", () => {
    const low = products.filter(
      (p) => p.min_stock_threshold > 0 && productTotal(p.id) <= p.min_stock_threshold,
    );
    let created = 0;
    for (const p of low) {
      if (notifications.some((n) => n.product_id === p.id && !n.read)) continue;
      notifications.unshift({
        id: nextNotificationId(),
        type: "low_stock",
        title: `Düşük stok: ${p.sku}`,
        message: `${p.name} stoğu eşiğin altında (${productTotal(p.id)}/${p.min_stock_threshold}).`,
        product_id: p.id,
        read: false,
        created_at: new Date().toISOString(),
      });
      created += 1;
    }
    return HttpResponse.json({ created });
  }),

  /* ── geo: region analysis + saved regions ─────────────────────────────── */
  http.post("*/api/v1/geo/region-analysis", async ({ request }) => {
    const { ring } = (await request.json()) as { ring: LatLng[] };
    const inside = warehouses.filter((w) => pointInRing(w.location, ring));
    const centroid: LatLng = {
      lat: ring.reduce((s, p) => s + p.lat, 0) / ring.length,
      lng: ring.reduce((s, p) => s + p.lng, 0) / ring.length,
    };
    let maxPair = 0;
    for (const a of inside) {
      for (const b of inside) {
        maxPair = Math.max(maxPair, haversineKm(a.location, b.location) * 1000);
      }
    }
    const rows = inside.map((wh) => {
      const bins = binsByWarehouse.get(wh.id) ?? [];
      const used = bins.filter((b) => binQuantity(b.id) > 0).length;
      return {
        warehouse_id: wh.id,
        warehouse_name: wh.name,
        address: wh.address,
        location: wh.location,
        zone_count: locations.filter((l) => l.warehouse_id === wh.id && l.type === "zone").length,
        rack_count: locations.filter((l) => l.warehouse_id === wh.id && l.type === "rack").length,
        bin_count: bins.length,
        used_bin_count: used,
        total_quantity: bins.reduce((s, b) => s + binQuantity(b.id), 0),
        occupancy_percent: bins.length ? Math.round((used / bins.length) * 1000) / 10 : 0,
        distance_to_centroid_m: Math.round(haversineKm(wh.location, centroid) * 1000),
      };
    });
    const totalBins = rows.reduce((s, r) => s + r.bin_count, 0);
    const usedBins = rows.reduce((s, r) => s + r.used_bin_count, 0);
    const lowStock = products.filter(
      (p) => p.min_stock_threshold > 0 && productTotal(p.id) <= p.min_stock_threshold,
    ).length;
    return HttpResponse.json({
      area_m2: ringAreaM2(ring),
      centroid,
      warehouse_count: rows.length,
      total_quantity: rows.reduce((s, r) => s + r.total_quantity, 0),
      total_bins: totalBins,
      used_bins: usedBins,
      occupancy_percent: totalBins ? Math.round((usedBins / totalBins) * 1000) / 10 : 0,
      low_stock_product_count: rows.length > 0 ? lowStock : 0,
      max_pairwise_distance_m: Math.round(maxPair),
      warehouses: rows,
    });
  }),
  http.get("*/api/v1/regions", () => HttpResponse.json(regions)),
  http.post("*/api/v1/regions", async ({ request }) => {
    const body = (await request.json()) as { name: string; ring: LatLng[] };
    const region: Region = {
      id: nextRegionId(),
      name: body.name,
      ring: body.ring,
      created_at: new Date().toISOString(),
    };
    regions.push(region);
    return HttpResponse.json(region, { status: 201 });
  }),
  http.patch("*/api/v1/regions/:id", async ({ params, request }) => {
    const region = regions.find((r) => r.id === Number(params.id));
    if (!region) return err(404, "NOT_FOUND", "Bölge bulunamadı");
    Object.assign(region, (await request.json()) as Partial<Region>);
    return HttpResponse.json(region);
  }),
  http.delete("*/api/v1/regions/:id", ({ params }) => {
    const idx = regions.findIndex((r) => r.id === Number(params.id));
    if (idx < 0) return err(404, "NOT_FOUND", "Bölge bulunamadı");
    regions.splice(idx, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  /* ── customers + network analysis ─────────────────────────────────────── */
  http.get("*/api/v1/customers", () => HttpResponse.json(customers)),
  http.post("*/api/v1/customers/import-csv", () =>
    HttpResponse.json({ created: 4, updated: 0, errors: [] }),
  ),
  http.get("*/api/v1/network/demand-points", () =>
    HttpResponse.json(
      customers.map(({ id, name, location, weight }) => ({ id, name, location, weight })),
    ),
  ),
  http.post("*/api/v1/network/center-of-gravity", async ({ request }) => {
    const { n_sites: k } = (await request.json()) as { n_sites: number };
    if (customers.length < Math.max(2, k)) {
      return err(422, "VALIDATION", "Analiz için yeterli müşteri noktası yok");
    }
    const { centers, assignment } = weightedKMeans(customers, k);
    const currentTotal = customers.reduce(
      (s, c) => s + c.weight * haversineKm(c.location, nearestWarehouse(c.location).location),
      0,
    );
    const proposedTotal = customers.reduce(
      (s, c, i) => s + c.weight * haversineKm(c.location, centers[assignment[i]]),
      0,
    );
    return HttpResponse.json({
      n_sites: k,
      proposed_sites: centers.map((center, ci) => ({
        location: { lat: Math.round(center.lat * 1e4) / 1e4, lng: Math.round(center.lng * 1e4) / 1e4 },
        assigned_customers: assignment.filter((a) => a === ci).length,
        assigned_weight: customers.reduce((s, c, i) => s + (assignment[i] === ci ? c.weight : 0), 0),
      })),
      assignments: customers.map((c, i) => ({
        customer_id: c.id,
        from_location: c.location,
        to_location: centers[assignment[i]],
        weight: c.weight,
        distance_m: Math.round(haversineKm(c.location, centers[assignment[i]]) * 1000),
      })),
      current_total_weighted_km: Math.round(currentTotal * 10) / 10,
      proposed_total_weighted_km: Math.round(proposedTotal * 10) / 10,
      improvement_percent: Math.round(((currentTotal - proposedTotal) / currentTotal) * 1000) / 10,
    });
  }),
  http.get("*/api/v1/network/closest-facility", () => {
    const assignments = customers.map((c) => {
      const wh = nearestWarehouse(c.location);
      return {
        customer_id: c.id,
        from_location: c.location,
        to_location: wh.location,
        weight: c.weight,
        distance_m: Math.round(haversineKm(c.location, wh.location) * 1000),
        warehouse_id: wh.id,
      };
    });
    const cells = voronoiCells(warehouses.map((w) => w.location));
    return HttpResponse.json({
      assignments: assignments.map(({ warehouse_id: _ignored, ...a }) => a),
      loads: warehouses.map((wh) => {
        const mine = assignments.filter((a) => a.warehouse_id === wh.id);
        return {
          warehouse_id: wh.id,
          warehouse_name: wh.name,
          location: wh.location,
          customer_count: mine.length,
          total_weight: mine.reduce((s, a) => s + a.weight, 0),
          avg_distance_km: mine.length
            ? Math.round((mine.reduce((s, a) => s + a.distance_m, 0) / mine.length / 1000) * 10) / 10
            : 0,
        };
      }),
      territories: warehouses.map((wh, i) => ({ warehouse_id: wh.id, ring: cells[i] })),
    });
  }),
  http.get("*/api/v1/network/coverage", () => {
    const bands = [10, 25, 50];
    const covered = (c: (typeof customers)[number]) =>
      warehouses.some((wh) => haversineKm(c.location, wh.location) <= 50);
    const body: Coverage = {
      mode: "rings",
      note: "Kuş uçuşu kapsama halkaları (10/25/50 km) — demo modu tarayıcıda hesaplar; gerçek kurulumda ORS_API_KEY ile sürüş süresi isochrone'ları kullanılır.",
      warehouses: warehouses.map((wh) => ({
        warehouse_id: wh.id,
        warehouse_name: wh.name,
        bands: bands.map((radius) => {
          const within = customers.filter((c) => haversineKm(c.location, wh.location) <= radius);
          return {
            radius_km: radius,
            ring: circleRing(wh.location, radius),
            customer_count: within.length,
            covered_weight: within.reduce((s, c) => s + c.weight, 0),
          };
        }),
        isochrones: null,
      })),
      uncovered_customers: customers.filter((c) => !covered(c)).length,
      uncovered_weight: customers.filter((c) => !covered(c)).reduce((s, c) => s + c.weight, 0),
    };
    return HttpResponse.json(body);
  }),
  http.get("*/api/v1/network/flow-map", ({ request }) => {
    const day = new URL(request.url).searchParams.get("day");
    const whOfLocation = (locId: number | null) =>
      locId ? warehouses.find((w) => w.id === locationById(locId)?.warehouse_id) : undefined;
    const arcs = new Map<string, { fromWh: (typeof warehouses)[number]; toWh: (typeof warehouses)[number]; qty: number; n: number }>();
    for (const m of movements) {
      if (m.type !== "transfer") continue;
      if (day && !m.created_at.startsWith(day)) continue;
      const fromWh = whOfLocation(m.from_location_id);
      const toWh = whOfLocation(m.to_location_id);
      if (!fromWh || !toWh || fromWh.id === toWh.id) continue;
      const key = `${fromWh.id}-${toWh.id}`;
      const arc = arcs.get(key) ?? { fromWh, toWh, qty: 0, n: 0 };
      arc.qty += m.quantity;
      arc.n += 1;
      arcs.set(key, arc);
    }
    return HttpResponse.json({
      arcs: [...arcs.values()].map((a) => ({
        from_warehouse_id: a.fromWh.id,
        from_name: a.fromWh.name,
        from_location: a.fromWh.location,
        to_warehouse_id: a.toWh.id,
        to_name: a.toWh.name,
        to_location: a.toWh.location,
        total_quantity: a.qty,
        transfer_count: a.n,
      })),
    });
  }),

  /* ── Faz 4: VRP teslimat turları ──────────────────────────────────────── */
  http.post("*/api/v1/network/vehicle-routes", async ({ request }) => {
    const body = (await request.json()) as {
      warehouse_id: number;
      vehicle_count: number;
      capacity: number;
    };
    const warehouse = warehouses.find((w) => w.id === body.warehouse_id);
    if (!warehouse) return err(404, "NOT_FOUND", "Depo bulunamadı");
    const mine = customers
      .filter((c) => nearestWh(c.location).id === warehouse.id)
      .map((c): VrpStop => ({ id: c.id, lat: c.location.lat, lng: c.location.lng, demand: c.weight }));
    if (mine.length < 2) {
      return err(422, "VALIDATION", "Bu depoya atanmış en az 2 müşteri gerekli.");
    }
    const routes = solveVrp(warehouse.location, mine, body.vehicle_count, body.capacity);
    const byId = new Map(customers.map((c) => [c.id, c]));
    let totalKm = 0;
    const tours = routes.map((route, i) => {
      const stops = route.stops.map((s) => ({
        customer_id: s.id,
        name: byId.get(s.id)!.name,
        location: { lat: s.lat, lng: s.lng },
        demand: s.demand,
        service_min: SERVICE_MIN,
      }));
      const plan = buildPlan(
        warehouse.location,
        stops.map((s) => ({
          id: s.customer_id, name: s.name, lat: s.location.lat, lng: s.location.lng,
          serviceMin: s.service_min,
        })),
      );
      totalKm += plan.totalKm;
      return {
        vehicle_name: `Araç ${i + 1}`,
        stops,
        distance_km: Math.round(plan.totalKm * 10) / 10,
        duration_min: Math.round(plan.totalMin * 10) / 10,
        load: route.load,
      };
    });
    return HttpResponse.json({
      warehouse_id: warehouse.id,
      vehicle_count: body.vehicle_count,
      capacity: body.capacity,
      tours,
      total_km: Math.round(totalKm * 10) / 10,
      unassigned_customers: 0,
      note: `Kuş uçuşu mesafeler + durak başına ${SERVICE_MIN} dk servis. Clarke-Wright + 2-opt.`,
    });
  }),

  /* ── Faz 4: canlı sevkiyatlar (durumsuz takip) ────────────────────────── */
  http.post("*/api/v1/shipments", async ({ request }) => {
    const body = (await request.json()) as {
      warehouse_id: number;
      tours: { vehicle_name: string; stops: { customer_id: number; name: string; location: LatLng; demand: number; service_min: number }[] }[];
      time_scale?: number;
      base_speed_kmh?: number;
    };
    const warehouse = warehouses.find((w) => w.id === body.warehouse_id);
    if (!warehouse) return err(404, "NOT_FOUND", "Depo bulunamadı");
    const now = Date.now();
    const created: DemoShipment[] = [];
    body.tours.forEach((tour, i) => {
      if (!tour.stops.length) return;
      const stops = tour.stops.map((s) => ({
        customer_id: s.customer_id, name: s.name, lat: s.location.lat, lng: s.location.lng,
        demand: s.demand, service_min: s.service_min,
      }));
      const plan = buildPlan(
        warehouse.location,
        stops.map((s) => ({ id: s.customer_id, name: s.name, lat: s.lat, lng: s.lng, serviceMin: s.service_min })),
        body.base_speed_kmh ?? 65,
      );
      const s: DemoShipment = {
        id: nextShipmentId(),
        warehouse_id: warehouse.id,
        vehicle_name: tour.vehicle_name,
        stops,
        depot: warehouse.location,
        base_speed_kmh: body.base_speed_kmh ?? 65,
        time_scale: body.time_scale ?? 30,
        total_km: plan.totalKm,
        total_min: plan.totalMin,
        depart_at_ms: now + 30000 * i,
      };
      shipments.push(s);
      created.push(s);
    });
    return HttpResponse.json(created.map(shipmentOut), { status: 201 });
  }),
  http.get("*/api/v1/shipments/active", () => HttpResponse.json(shipments.map(shipmentOut))),
  http.delete("*/api/v1/shipments", () => {
    shipments.length = 0;
    return new HttpResponse(null, { status: 204 });
  }),
  http.get("*/api/v1/shipments/:id", ({ params }) => {
    const s = shipments.find((x) => x.id === Number(params.id));
    if (!s) return err(404, "NOT_FOUND", "Sevkiyat bulunamadı");
    const plan = planOf(s);
    const elapsed = Math.max(-1, ((Date.now() - s.depart_at_ms) / 60000) * s.time_scale);
    const stops = s.stops.map((st, idx) => {
      const arrive = plan.legs[idx].cumArriveMin;
      const depart = arrive + st.service_min;
      let status: "done" | "current" | "pending";
      let eta: number | null;
      if (elapsed >= depart) {
        status = "done";
        eta = null;
      } else if (elapsed >= arrive) {
        status = "current";
        eta = 0;
      } else {
        status = "pending";
        eta = Math.round((arrive - elapsed) * 10) / 10;
      }
      return {
        customer_id: st.customer_id, name: st.name,
        location: { lat: st.lat, lng: st.lng }, demand: st.demand,
        status, eta_min: eta, planned_arrive_min: Math.round(arrive * 10) / 10,
      };
    });
    return HttpResponse.json({ ...shipmentOut(s), stops });
  }),

  /* ── Faz 4: what-if senaryosu (depo kapat) ────────────────────────────── */
  http.post("*/api/v1/network/scenario", async ({ request }) => {
    const { closed_warehouse_ids } = (await request.json()) as { closed_warehouse_ids: number[] };
    const remaining = warehouses.filter((w) => !closed_warehouse_ids.includes(w.id));
    if (remaining.length === 0) return err(422, "VALIDATION", "En az bir depo açık kalmalı.");
    if (remaining.length === warehouses.length) {
      return err(422, "VALIDATION", "Kapatılacak depo bulunamadı.");
    }
    const side = (whs: typeof warehouses) => {
      let weighted = 0;
      let dist = 0;
      let uncovered = 0;
      const assign: Record<number, number> = {};
      const loads = new Map<number, { warehouse_id: number; warehouse_name: string; customer_count: number; total_weight: number }>();
      for (const w of whs) {
        loads.set(w.id, { warehouse_id: w.id, warehouse_name: w.name, customer_count: 0, total_weight: 0 });
      }
      for (const c of customers) {
        const near = whs.reduce((b, w) =>
          haversineKm(c.location, w.location) < haversineKm(c.location, b.location) ? w : b,
        );
        const dkm = haversineKm(c.location, near.location);
        assign[c.id] = near.id;
        weighted += dkm * c.weight;
        dist += dkm;
        if (dkm > COVERAGE_LIMIT_KM) uncovered++;
        const load = loads.get(near.id)!;
        load.customer_count++;
        load.total_weight += c.weight;
      }
      return {
        assign,
        side: {
          total_weighted_km: Math.round(weighted * 10) / 10,
          avg_distance_km: Math.round((dist / customers.length) * 10) / 10,
          uncovered_customers: uncovered,
          loads: [...loads.values()],
        },
      };
    };
    const base = side(warehouses);
    const after = side(remaining);
    const delta = after.side.total_weighted_km - base.side.total_weighted_km;
    return HttpResponse.json({
      closed_warehouse_ids,
      baseline: base.side,
      scenario: after.side,
      delta_weighted_km: Math.round(delta * 10) / 10,
      delta_percent: Math.round((delta / Math.max(base.side.total_weighted_km, 0.001)) * 1000) / 10,
      reassigned_customers: customers.filter((c) => base.assign[c.id] !== after.assign[c.id]).length,
    });
  }),

  /* ── Faz 4: tahmin, reorder, KPI ──────────────────────────────────────── */
  http.get("*/api/v1/products/:id/forecast", ({ params }) => {
    const product = productById(Number(params.id));
    if (!product) return err(404, "NOT_FOUND", "Ürün bulunamadı");
    const series = dailyOutflow(product.id);
    const forecast = holtForecast(series, 14);
    const { avg, std } = demandStats(series);
    const current = productTotal(product.id);
    const today = new Date();
    const points: { day: string; quantity: number; kind: "actual" | "forecast" }[] = [];
    series.forEach((q, i) => {
      const day = new Date(today.getTime() - (series.length - 1 - i) * 86_400_000);
      points.push({ day: day.toISOString().slice(0, 10), quantity: q, kind: "actual" });
    });
    forecast.forEach((q, i) => {
      const day = new Date(today.getTime() + (i + 1) * 86_400_000);
      points.push({ day: day.toISOString().slice(0, 10), quantity: Math.round(q * 10) / 10, kind: "forecast" });
    });
    return HttpResponse.json({
      product_id: product.id,
      sku: product.sku,
      name: product.name,
      current_stock: current,
      daily_avg: Math.round(avg * 100) / 100,
      daily_std: Math.round(std * 100) / 100,
      reorder_point: reorderPoint(series),
      days_until_stockout: daysUntilStockout(current, forecast),
      series: points,
    });
  }),
  http.get("*/api/v1/reports/reorder-suggestions", () => {
    const out = [];
    for (const p of products) {
      const series = dailyOutflow(p.id);
      const { avg } = demandStats(series);
      if (avg <= 0 && p.min_stock_threshold <= 0) continue;
      const rop = Math.max(reorderPoint(series), p.min_stock_threshold);
      const current = productTotal(p.id);
      if (current > rop) continue;
      const target = rop + Math.ceil(avg * 7);
      out.push({
        product_id: p.id, sku: p.sku, name: p.name,
        current_stock: current, reorder_point: rop,
        days_until_stockout: daysUntilStockout(current, holtForecast(series, 14)),
        suggested_order_qty: Math.max(target - current, 0),
      });
    }
    out.sort((a, b) => (a.days_until_stockout ?? 999) - (b.days_until_stockout ?? 999));
    return HttpResponse.json(out);
  }),
  http.get("*/api/v1/reports/kpi", () => {
    const since30 = Date.now() - 30 * 86_400_000;
    const since7 = Date.now() - 7 * 86_400_000;
    const sum = (type: string) =>
      movements
        .filter((m) => m.type === type && new Date(m.created_at).getTime() >= since30)
        .reduce((s, m) => s + m.quantity, 0);
    const outbound = sum("pick");
    const totalStock = [...stock.values()].reduce((s, q) => s + q, 0);
    const moves7 = movements.filter((m) => new Date(m.created_at).getTime() >= since7).length;
    let allBins = 0;
    let usedBins = 0;
    for (const bins of binsByWarehouse.values()) {
      for (const b of bins) {
        allBins++;
        if (binQuantity(b.id) > 0) usedBins++;
      }
    }
    const counts = new Map<number, number>();
    for (const m of movements) counts.set(m.product_id, (counts.get(m.product_id) ?? 0) + 1);
    const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const now = Date.now();
    const active = shipments.filter((s) => {
      const el = ((now - s.depart_at_ms) / 60000) * s.time_scale;
      return el >= 0 && el < s.total_min;
    }).length;
    return HttpResponse.json({
      inventory_turnover_30d: Math.round((outbound / Math.max(totalStock, 1)) * 1000) / 1000,
      outbound_units_30d: outbound,
      inbound_units_30d: sum("receive"),
      movements_per_day_7d: Math.round((moves7 / 7) * 10) / 10,
      occupancy_percent: Math.round((usedBins / Math.max(allBins, 1)) * 1000) / 10,
      active_alert_products: products.filter(
        (p) => p.min_stock_threshold > 0 && productTotal(p.id) <= p.min_stock_threshold,
      ).length,
      open_orders: orders.filter((o) => o.status === "open").length,
      active_shipments: active,
      busiest_product_sku: busiest ? productById(busiest[0])?.sku ?? null : null,
    });
  }),

  /* ── Faz 4: siparişler + dalga toplama ────────────────────────────────── */
  http.get("*/api/v1/orders", ({ request }) => {
    const status = new URL(request.url).searchParams.get("status");
    const rows = (status ? orders.filter((o) => o.status === status) : orders)
      .slice()
      .reverse()
      .map((o) => ({
        ...o,
        lines: o.lines.map((l) => {
          const p = productById(l.product_id)!;
          return { product_id: l.product_id, sku: p.sku, product_name: p.name, quantity: l.quantity };
        }),
      }));
    return HttpResponse.json(rows);
  }),
  http.post("*/api/v1/orders", async ({ request }) => {
    const body = (await request.json()) as {
      warehouse_id: number;
      customer_name: string;
      lines: { product_id: number; quantity: number }[];
    };
    const id = nextOrderId();
    const order = {
      id,
      code: `SIP-${String(id).padStart(4, "0")}`,
      warehouse_id: body.warehouse_id,
      customer_name: body.customer_name,
      status: "open" as const,
      created_at: new Date().toISOString(),
      lines: body.lines,
    };
    orders.push(order);
    return HttpResponse.json(
      {
        ...order,
        lines: order.lines.map((l) => {
          const p = productById(l.product_id)!;
          return { product_id: l.product_id, sku: p.sku, product_name: p.name, quantity: l.quantity };
        }),
      },
      { status: 201 },
    );
  }),
  http.post("*/api/v1/orders/wave-pick", async ({ request }) => {
    const { order_ids } = (await request.json()) as { order_ids: number[] };
    const picked = orders.filter((o) => order_ids.includes(o.id));
    if (picked.length !== order_ids.length) return err(422, "VALIDATION", "Sipariş(ler) bulunamadı.");
    const whIds = new Set(picked.map((o) => o.warehouse_id));
    if (whIds.size !== 1) return err(422, "VALIDATION", "Dalga toplama tek depoda yapılır.");
    const warehouseId = [...whIds][0];
    const totals = new Map<number, number>();
    for (const o of picked) {
      for (const l of o.lines) totals.set(l.product_id, (totals.get(l.product_id) ?? 0) + l.quantity);
    }
    const bins = binsByWarehouse.get(warehouseId) ?? [];
    const lines = [];
    const pickBinIds: number[] = [];
    for (const [pid, qty] of [...totals.entries()].sort((a, b) => a[0] - b[0])) {
      const p = productById(pid)!;
      let bestBin: number | null = null;
      let bestQty = 0;
      let bestCode: string | null = null;
      for (const b of bins) {
        const q = stock.get(`${pid}:${b.id}`) ?? 0;
        if (q > bestQty) {
          bestQty = q;
          bestBin = b.id;
          bestCode = b.code;
        }
      }
      lines.push({
        product_id: pid, sku: p.sku, product_name: p.name,
        total_quantity: qty, location_id: bestBin, location_code: bestCode,
      });
      if (bestBin) pickBinIds.push(bestBin);
    }
    const routeResult = pickBinIds.length >= 2 ? solvePickRoute(warehouseId, pickBinIds) : null;
    const route = routeResult && !("error" in routeResult) ? routeResult : null;
    picked.forEach((o) => {
      o.status = "waved";
    });
    return HttpResponse.json({ order_ids, warehouse_id: warehouseId, lines, route });
  }),
  http.post("*/api/v1/orders/:id/picked", ({ params }) => {
    const order = orders.find((o) => o.id === Number(params.id));
    if (!order) return err(404, "NOT_FOUND", "Sipariş bulunamadı");
    order.status = "picked";
    return HttpResponse.json({
      ...order,
      lines: order.lines.map((l) => {
        const p = productById(l.product_id)!;
        return { product_id: l.product_id, sku: p.sku, product_name: p.name, quantity: l.quantity };
      }),
    });
  }),

  /* ── picking ──────────────────────────────────────────────────────────── */
  http.post("*/api/v1/warehouses/:id/pick-route", async ({ params, request }) => {
    const body = (await request.json()) as { location_ids?: number[]; items?: { product_id: number }[] };
    let locationIds = body.location_ids ?? [];
    if ((!locationIds || locationIds.length === 0) && body.items) {
      // resolve products → their most-stocked bin in this warehouse
      const bins = binsByWarehouse.get(Number(params.id)) ?? [];
      locationIds = body.items
        .map((item) => {
          let bestBin = 0;
          let bestQty = 0;
          for (const b of bins) {
            const qty = stock.get(`${item.product_id}:${b.id}`) ?? 0;
            if (qty > bestQty) {
              bestQty = qty;
              bestBin = b.id;
            }
          }
          return bestBin;
        })
        .filter(Boolean);
    }
    const result = solvePickRoute(Number(params.id), locationIds);
    if ("error" in result) return err(422, "VALIDATION", result.error);
    return HttpResponse.json(result);
  }),

  /* ── AI (rule-based stand-in, honest about being a demo) ──────────────── */
  http.post("*/api/v1/ai/ask", async ({ request }) => {
    const { question } = (await request.json()) as { question: string };
    const q = question.toLowerCase();
    let response: AskResponse;
    if (/(düşük|altına|altında|eşik|kritik)/.test(q)) {
      const rows = products
        .filter((p) => p.min_stock_threshold > 0 && productTotal(p.id) <= p.min_stock_threshold * 1.5)
        .map((p) => ({
          SKU: p.sku, "Ürün": p.name,
          "Stok": productTotal(p.id), "Eşik": p.min_stock_threshold,
        }));
      const productIds = products
        .filter((p) => rows.some((r) => r.SKU === p.sku))
        .map((p) => p.id);
      const locationIds = [...stock.entries()]
        .filter(([key, qty]) => qty > 0 && productIds.includes(Number(key.split(":")[0])))
        .map(([key]) => Number(key.split(":")[1]));
      response = {
        ai_available: true,
        question,
        interpretation: "Eşiğin (ve 1.5 katının) altındaki ürünler listelendi; bulundukları gözler 3B'de vurgulanabilir.",
        columns: ["SKU", "Ürün", "Stok", "Eşik"],
        rows,
        location_ids: [...new Set(locationIds)],
        error: null,
      };
    } else if (/(hareket|en çok|yoğun)/.test(q)) {
      const counts = new Map<number, number>();
      for (const m of movements) counts.set(m.product_id, (counts.get(m.product_id) ?? 0) + 1);
      const rows = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([pid, n]) => {
          const p = products.find((x) => x.id === pid)!;
          return { SKU: p.sku, "Ürün": p.name, "Hareket": n };
        });
      response = {
        ai_available: true, question,
        interpretation: "Son 14 günün hareket sayısına göre en yoğun ürünler.",
        columns: ["SKU", "Ürün", "Hareket"], rows, location_ids: [], error: null,
      };
    } else {
      const rows = products
        .map((p) => ({ SKU: p.sku, "Ürün": p.name, "Toplam": productTotal(p.id), "Birim": p.unit }))
        .sort((a, b) => Number(b["Toplam"]) - Number(a["Toplam"]))
        .slice(0, 10);
      response = {
        ai_available: true, question,
        interpretation: "Demo modu: soru kural tabanlı yorumlandı — stok toplamları listelendi. (Gerçek kurulumda OpenRouter modeli beyaz-listeli sorguya derler.)",
        columns: ["SKU", "Ürün", "Toplam", "Birim"], rows, location_ids: [], error: null,
      };
    }
    return HttpResponse.json(response);
  }),
  http.post("*/api/v1/ai/slotting", async ({ request }) => {
    const { warehouse_id: whId } = (await request.json()) as { warehouse_id: number };
    const bins = (binsByWarehouse.get(whId) ?? []).filter((b) => binQuantity(b.id) === 0);
    const scored = bins
      .map((b) => ({ bin: b, score: 1 / (1 + b.pos_y + Math.abs(b.pos_x - 10) / 10 + b.pos_z) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    return HttpResponse.json({
      ai_available: true,
      suggestions: scored.map((s, i) => ({
        location_id: s.bin.id,
        code: s.bin.code,
        score: Math.round(s.score * 100) / 100,
        reason:
          i === 0
            ? "Kapıya en yakın boş göz — toplama mesafesi minimum"
            : "Alt seviye, erişimi kolay boş göz",
      })),
      explanation: "Kural tabanlı öneri: kapı mesafesi + seviye. (Demo modu)",
    });
  }),
  http.get("*/api/v1/ai/summary", () => {
    const total = products.reduce((s, p) => s + productTotal(p.id), 0);
    const low = products.filter(
      (p) => p.min_stock_threshold > 0 && productTotal(p.id) <= p.min_stock_threshold,
    );
    return HttpResponse.json({
      ai_available: true,
      summary: `${warehouses.length} depoda toplam ${total} adet stok bulunuyor. Son 14 günde ${movements.length} hareket kaydedildi; sevkiyat ağırlıklı olarak İstanbul'dan Ankara ve İzmir'e aktı.`,
      anomalies: low.map((p) => `${p.sku} eşiğin altında (${productTotal(p.id)}/${p.min_stock_threshold})`),
    });
  }),
];
