import { http, HttpResponse } from "msw";
import type {
  CenterOfGravity,
  ClosestFacility,
  Coverage,
  Customer,
  DemandPoint,
  Kpi,
  Layout3D,
  LocationDetail,
  PickRoute,
  RegionAnalysis,
  ScenarioResult,
  Shipment,
  Tour,
  User,
  Warehouse,
} from "@/types";

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
    { id: 101, code: "Z1-A1-R1-S1-B1", pos_x: 1, pos_y: 1, pos_z: 0, dim_w: 1, dim_d: 1, dim_h: 1.5, rotation: 0, capacity: 100, quantity: 30, movement_count: 12, alert: "critical", alert_sku: "PLT-EUR", alert_total: 5, alert_threshold: 20 },
    { id: 102, code: "Z1-A1-R1-S1-B2", pos_x: 2, pos_y: 1, pos_z: 0, dim_w: 1, dim_d: 1, dim_h: 1.5, rotation: 0, capacity: 100, quantity: 0, movement_count: 0, alert: null },
    { id: 103, code: "Z1-A1-R1-S2-B1", pos_x: 1, pos_y: 1, pos_z: 1.5, dim_w: 1, dim_d: 1, dim_h: 1.5, rotation: 0, capacity: 100, quantity: 95, movement_count: 3, alert: "warning", alert_sku: "BNT-120", alert_total: 30, alert_threshold: 25 },
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

export const demoCustomers: Customer[] = [
  { id: 1, name: "İstanbul Perakende", location: { lat: 41.01, lng: 28.97 }, weight: 25, city: "İstanbul", created_at: "2026-01-01T00:00:00Z" },
  { id: 2, name: "Ankara Bayi", location: { lat: 39.92, lng: 32.85 }, weight: 18, city: "Ankara", created_at: "2026-01-01T00:00:00Z" },
  { id: 3, name: "İzmir Market", location: { lat: 38.42, lng: 27.14 }, weight: 15, city: "İzmir", created_at: "2026-01-01T00:00:00Z" },
];

export const demoDemandPoints: DemandPoint[] = demoCustomers.map(
  ({ id, name, location, weight }) => ({ id, name, location, weight }),
);

export const demoCog: CenterOfGravity = {
  n_sites: 1,
  proposed_sites: [
    { location: { lat: 40.11, lng: 29.61 }, assigned_customers: 3, assigned_weight: 58 },
  ],
  assignments: demoCustomers.map((c) => ({
    customer_id: c.id,
    from_location: c.location,
    to_location: { lat: 40.11, lng: 29.61 },
    weight: c.weight,
    distance_m: 150_000,
  })),
  current_total_weighted_km: 12_400,
  proposed_total_weighted_km: 9_300,
  improvement_percent: 25,
};

export const demoClosestFacility: ClosestFacility = {
  assignments: demoCustomers.map((c) => ({
    customer_id: c.id,
    from_location: c.location,
    to_location: demoWarehouse.location,
    weight: c.weight,
    distance_m: 90_000,
  })),
  loads: [
    {
      warehouse_id: 3,
      warehouse_name: "İstanbul Ana Depo",
      location: demoWarehouse.location,
      customer_count: 3,
      total_weight: 58,
      avg_distance_km: 214.5,
    },
  ],
  territories: [
    {
      warehouse_id: 3,
      ring: [
        { lat: 36, lng: 26 },
        { lat: 36, lng: 45 },
        { lat: 42, lng: 45 },
        { lat: 42, lng: 26 },
      ],
    },
  ],
};

export const demoCoverage: Coverage = {
  mode: "rings",
  note: "Kuş uçuşu halkalar (10/25/50 km) — ORS anahtarı ile sürüş süresi kapsamı açılır.",
  warehouses: [
    {
      warehouse_id: 3,
      warehouse_name: "İstanbul Ana Depo",
      bands: [10, 25, 50].map((radius_km) => ({
        radius_km,
        ring: [
          { lat: 41 - radius_km / 111, lng: 28.79 },
          { lat: 41.06, lng: 28.79 + radius_km / 85 },
          { lat: 41 + radius_km / 111, lng: 28.79 },
          { lat: 41.06, lng: 28.79 - radius_km / 85 },
        ],
        customer_count: radius_km >= 25 ? 1 : 0,
        covered_weight: radius_km >= 25 ? 25 : 0,
      })),
      isochrones: null,
    },
  ],
  uncovered_customers: 2,
  uncovered_weight: 33,
};

export const demoPickRoute: PickRoute = {
  warehouse_id: 3,
  pick_count: 2,
  best_policy: "optimized",
  routes: (["s_shape", "largest_gap", "optimized"] as const).map((policy, i) => ({
    policy,
    total_m: [42.5, 38.0, 31.5][i],
    stops: [
      { order: 1, location_id: 101, code: "Z1-A1-R1-S1-B1", x: 1.5, y: 1.5, product_sku: "RLM-6204", quantity: 5 },
      { order: 2, location_id: 103, code: "Z1-A1-R1-S2-B1", x: 1.5, y: 1.5, product_sku: null, quantity: null },
    ],
    path: [
      { x: 20, y: 0 },
      { x: 1.5, y: 0 },
      { x: 1.5, y: 1.5 },
      { x: 20, y: 0 },
    ],
  })),
};

export const demoTour: Tour = {
  vehicle_name: "Araç 1",
  stops: [
    { customer_id: 1, name: "İstanbul Perakende", location: { lat: 41.01, lng: 28.97 }, demand: 25, service_min: 12 },
    { customer_id: 4, name: "Bursa Sanayi", location: { lat: 40.19, lng: 29.06 }, demand: 12, service_min: 12 },
  ],
  distance_km: 245.6,
  duration_min: 258.4,
  load: 37,
};

export const demoShipment: Shipment = {
  id: 1,
  warehouse_id: 3,
  vehicle_name: "Araç 1",
  total_km: 245.6,
  total_min: 258.4,
  time_scale: 30,
  depart_at: "2026-07-05T09:00:00Z",
  stop_count: 2,
  live: {
    status: "en_route",
    position: { lat: 40.7, lng: 29.1 },
    heading_deg: 118.5,
    speed_kmh: 63.2,
    progress_percent: 42.3,
    completed_stops: 1,
    current_stop: null,
    next_stop: "Bursa Sanayi",
    next_stop_eta_min: 38.5,
    next_stop_remaining_km: 41.2,
    eta_return_min: 149.1,
    elapsed_sim_min: 109.3,
  },
  route: [
    { lat: 41.06, lng: 28.79 },
    { lat: 41.01, lng: 28.97 },
    { lat: 40.19, lng: 29.06 },
    { lat: 41.06, lng: 28.79 },
  ],
};

export const demoScenario: ScenarioResult = {
  closed_warehouse_ids: [3],
  baseline: {
    total_weighted_km: 12400,
    avg_distance_km: 96.5,
    uncovered_customers: 12,
    loads: [],
  },
  scenario: {
    total_weighted_km: 15900,
    avg_distance_km: 128.3,
    uncovered_customers: 19,
    loads: [{ warehouse_id: 2, warehouse_name: "Ankara", customer_count: 24, total_weight: 180 }],
  },
  delta_weighted_km: 3500,
  delta_percent: 28.2,
  reassigned_customers: 9,
};

export const demoKpi: Kpi = {
  inventory_turnover_30d: 0.42,
  outbound_units_30d: 960,
  inbound_units_30d: 1200,
  movements_per_day_7d: 6.4,
  occupancy_percent: 23.5,
  active_alert_products: 1,
  open_orders: 3,
  active_shipments: 1,
  busiest_product_sku: "RLM-6204",
};

export const handlers = [
  http.get("/api/v1/shipments/active", () => HttpResponse.json([])),
  http.post("/api/v1/network/vehicle-routes", () =>
    HttpResponse.json({
      warehouse_id: 3,
      vehicle_count: 2,
      capacity: 60,
      tours: [demoTour],
      total_km: 245.6,
      unassigned_customers: 0,
      note: "Kuş uçuşu mesafeler + durak başına 12 dk servis.",
    }),
  ),
  http.post("/api/v1/shipments", () => HttpResponse.json([demoShipment], { status: 201 })),
  http.delete("/api/v1/shipments", () => new HttpResponse(null, { status: 204 })),
  http.get("/api/v1/shipments/:id", () =>
    HttpResponse.json({ ...demoShipment, stops: [] }),
  ),
  http.post("/api/v1/network/scenario", () => HttpResponse.json(demoScenario)),
  http.get("/api/v1/reports/kpi", () => HttpResponse.json(demoKpi)),
  http.get("/api/v1/reports/reorder-suggestions", () => HttpResponse.json([])),
  http.get("/api/v1/orders", () => HttpResponse.json([])),
  http.get("/api/v1/products", () =>
    HttpResponse.json({ items: [], total: 0, page: 1, page_size: 100 }),
  ),
  http.post("/api/v1/ai/slotting", () =>
    HttpResponse.json({ ai_available: true, suggestions: [], explanation: "" }),
  ),

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

  http.get("/api/v1/customers", () => HttpResponse.json(demoCustomers)),
  http.post("/api/v1/customers/import-csv", () =>
    HttpResponse.json({ created: 2, updated: 1, errors: [] }),
  ),
  http.get("/api/v1/network/demand-points", () => HttpResponse.json(demoDemandPoints)),
  http.post("/api/v1/network/center-of-gravity", () => HttpResponse.json(demoCog)),
  http.get("/api/v1/network/closest-facility", () => HttpResponse.json(demoClosestFacility)),
  http.get("/api/v1/network/coverage", () => HttpResponse.json(demoCoverage)),
  http.get("/api/v1/network/flow-map", () => HttpResponse.json({ arcs: [] })),
  http.post("/api/v1/warehouses/:id/pick-route", () => HttpResponse.json(demoPickRoute)),

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
