import { http, HttpResponse } from "msw";
import type { Layout3D, LocationDetail, RegionAnalysis, User, Warehouse } from "@/types";

export const demoUser: User = { id: 1, org_id: 1, email: "owner@demo.co", role: "owner" };

export const demoWarehouse: Warehouse = {
  id: 3,
  name: "İstanbul Ana Depo",
  address: "İkitelli OSB",
  location: { lat: 41.06, lng: 28.79 },
  footprint: null,
  local_width: 40,
  local_depth: 25,
  created_at: "2026-01-01T00:00:00Z",
};

export const demoLayout: Layout3D = {
  warehouse_id: 3,
  local_width: 40,
  local_depth: 25,
  zones: [],
  aisles: [],
  racks: [
    {
      id: 10, warehouse_id: 3, parent_id: 5, type: "rack", code: "Z1-A1-R1", label: null,
      pos_x: 1, pos_y: 1, pos_z: 0, dim_w: 4, dim_d: 1, dim_h: 3, rotation: 0,
      capacity: null, meta: null,
    },
  ],
  shelves: [
    {
      id: 20, warehouse_id: 3, parent_id: 10, type: "shelf", code: "Z1-A1-R1-S1", label: null,
      pos_x: 1, pos_y: 1, pos_z: 0, dim_w: 4, dim_d: 1, dim_h: 1.5, rotation: 0,
      capacity: null, meta: null,
    },
    {
      id: 21, warehouse_id: 3, parent_id: 10, type: "shelf", code: "Z1-A1-R1-S2", label: null,
      pos_x: 1, pos_y: 1, pos_z: 1.5, dim_w: 4, dim_d: 1, dim_h: 1.5, rotation: 0,
      capacity: null, meta: null,
    },
  ],
  bins: [
    { id: 101, code: "Z1-A1-R1-S1-B1", pos_x: 1, pos_y: 1, pos_z: 0, dim_w: 1, dim_d: 1, dim_h: 1.5, rotation: 0, capacity: 100, quantity: 30 },
    { id: 102, code: "Z1-A1-R1-S1-B2", pos_x: 2, pos_y: 1, pos_z: 0, dim_w: 1, dim_d: 1, dim_h: 1.5, rotation: 0, capacity: 100, quantity: 0 },
    { id: 103, code: "Z1-A1-R1-S2-B1", pos_x: 1, pos_y: 1, pos_z: 1.5, dim_w: 1, dim_d: 1, dim_h: 1.5, rotation: 0, capacity: 100, quantity: 95 },
  ],
};

export const demoLocationDetail: LocationDetail = {
  id: 101, warehouse_id: 3, parent_id: 20, type: "bin", code: "Z1-A1-R1-S1-B1", label: null,
  pos_x: 1, pos_y: 1, pos_z: 0, dim_w: 1, dim_d: 1, dim_h: 1.5, rotation: 0,
  capacity: 100, meta: null,
  stock: [
    { product_id: 7, sku: "RLM-6204", product_name: "Rulman 6204 2RS", unit: "adet", quantity: 30 },
  ],
  total_quantity: 30,
};

export const demoRegionAnalysis: RegionAnalysis = {
  area_m2: 950_000,
  centroid: { lat: 39.92, lng: 32.85 },
  warehouse_count: 1,
  total_quantity: 2271,
  total_bins: 164,
  used_bins: 37,
  occupancy_percent: 12.5,
  low_stock_product_count: 3,
  max_pairwise_distance_m: 0,
  warehouses: [
    {
      warehouse_id: 3,
      warehouse_name: "İstanbul Ana Depo",
      address: "İkitelli OSB",
      location: { lat: 41.06, lng: 28.79 },
      zone_count: 1,
      rack_count: 5,
      bin_count: 164,
      used_bin_count: 37,
      total_quantity: 2271,
      occupancy_percent: 12.5,
      distance_to_centroid_m: 351.2,
    },
  ],
};

export const handlers = [
  http.post("/api/v1/auth/login", async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.password === "yanlis") {
      return HttpResponse.json(
        { error: { code: "UNAUTHORIZED", message: "E-posta veya şifre hatalı", details: null } },
        { status: 401 },
      );
    }
    return HttpResponse.json({
      access_token: "test-token",
      token_type: "bearer",
      user: { ...demoUser, email: body.email },
    });
  }),

  http.get("/api/v1/warehouses", () => HttpResponse.json([demoWarehouse])),
  http.post("/api/v1/warehouses", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...demoWarehouse, ...body, id: 99 }, { status: 201 });
  }),
  http.get("/api/v1/warehouses/:id", () => HttpResponse.json(demoWarehouse)),
  http.get("/api/v1/warehouses/:id/locations", () => HttpResponse.json([])),
  http.get("/api/v1/warehouses/:id/layout-3d", () => HttpResponse.json(demoLayout)),
  http.post("/api/v1/warehouses/:id/layout/generate", async ({ request }) => {
    const body = (await request.json()) as { racks: unknown[] };
    return HttpResponse.json(
      {
        zone_id: 5,
        zone_code: "Z1",
        created_aisles: 1,
        created_racks: body.racks.length,
        created_shelves: 0,
        created_bins: 0,
        sample_codes: ["Z1-A1-R1-S1-B1"],
      },
      { status: 201 },
    );
  }),

  http.get("/api/v1/locations/:id", () => HttpResponse.json(demoLocationDetail)),

  http.get("/api/v1/stock/find-product", ({ request }) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    if (!q.toLowerCase().includes("rlm")) return HttpResponse.json([]);
    return HttpResponse.json([
      { location_id: 101, code: "Z1-A1-R1-S1-B1", warehouse_id: 3, warehouse_name: "İstanbul Ana Depo", quantity: 30 },
      { location_id: 103, code: "Z1-A1-R1-S2-B1", warehouse_id: 3, warehouse_name: "İstanbul Ana Depo", quantity: 95 },
    ]);
  }),

  http.get("/api/v1/notifications/unread-count", () => HttpResponse.json({ unread: 0 })),

  http.post("/api/v1/geo/region-analysis", () => HttpResponse.json(demoRegionAnalysis)),
  http.get("/api/v1/regions", () => HttpResponse.json([])),
  http.post("/api/v1/regions", async ({ request }) => {
    const body = (await request.json()) as { name: string; ring: unknown[] };
    return HttpResponse.json(
      { id: 7, name: body.name, ring: body.ring, created_at: "2026-01-01T00:00:00Z" },
      { status: 201 },
    );
  }),
];
