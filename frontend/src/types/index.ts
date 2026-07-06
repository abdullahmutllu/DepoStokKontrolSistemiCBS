export interface User {
  id: number;
  org_id: number;
  email: string;
  role: "owner" | "staff";
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Warehouse {
  id: number;
  name: string;
  address: string | null;
  location: LatLng;
  footprint: LatLng[] | null;
  local_width: number;
  local_depth: number;
  created_at: string;
  location_count?: number;
  bin_count?: number;
  product_count?: number;
  total_quantity?: number;
  occupancy_percent?: number | null;
}

export type LocationType = "zone" | "aisle" | "rack" | "shelf" | "bin";

export interface StorageLocation {
  id: number;
  warehouse_id: number;
  parent_id: number | null;
  type: LocationType;
  code: string;
  label: string | null;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  dim_w: number;
  dim_d: number;
  dim_h: number;
  rotation: number;
  capacity: number | null;
  meta: Record<string, unknown> | null;
}

export interface BinStock {
  product_id: number;
  sku: string;
  product_name: string;
  unit: string;
  quantity: number;
}

export interface LocationDetail extends StorageLocation {
  stock: BinStock[];
  total_quantity: number;
}

export interface Bin3D {
  id: number;
  code: string;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  dim_w: number;
  dim_d: number;
  dim_h: number;
  rotation: number;
  capacity: number | null;
  quantity: number;
  /** Son 30 gündeki giriş+çıkış hareket sayısı (ABC/hareket ısı modu). */
  movement_count?: number;
  /** Düşük stok pini: critical (eşik altı) | warning (1.5× eşik altı). */
  alert?: "critical" | "warning" | null;
  /** Pin rozeti bağlamı: hangi ürün, org geneli kaç adet / eşik. */
  alert_sku?: string | null;
  alert_total?: number | null;
  alert_threshold?: number | null;
}

export interface Layout3D {
  warehouse_id: number;
  local_width: number;
  local_depth: number;
  zones: StorageLocation[];
  aisles: StorageLocation[];
  racks: StorageLocation[];
  shelves: StorageLocation[];
  bins: Bin3D[];
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  barcode: string | null;
  dim_w: number | null;
  dim_d: number | null;
  dim_h: number | null;
  min_stock_threshold: number;
  image_url: string | null;
  created_at: string;
  total_quantity?: number;
  is_low_stock?: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface StockItem {
  id: number;
  product_id: number;
  location_id: number;
  quantity: number;
  updated_at: string;
}

export interface Movement {
  id: number;
  product_id: number;
  from_location_id: number | null;
  to_location_id: number | null;
  type: "receive" | "pick" | "transfer" | "adjust" | "count";
  quantity: number;
  user_id: number;
  note: string | null;
  created_at: string;
  product_sku: string;
  product_name: string;
  from_code: string | null;
  to_code: string | null;
  user_email: string | null;
}

export interface ProductLocation {
  location_id: number;
  code: string;
  warehouse_id: number;
  warehouse_name: string;
  quantity: number;
}

export interface LayoutGenerateResult {
  zone_id: number;
  zone_code: string;
  created_aisles: number;
  created_racks: number;
  created_shelves: number;
  created_bins: number;
  sample_codes: string[];
}

export interface RackPlacement {
  col: number;
  row: number;
  w_cells: number;
  d_cells: number;
  rotation: number;
  shelf_count: number;
  bins_per_shelf: number;
  shelf_height: number;
  bin_capacity: number | null;
  color?: string | null;
  rack_type?: string | null;
}

export interface DxfRect {
  x: number;
  y: number;
  w: number;
  d: number;
  rotation: number;
}

export interface DxfSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DxfPreview {
  units: string;
  scale_applied: number;
  bounds_w: number;
  bounds_d: number;
  racks: DxfRect[];
  zones: DxfRect[];
  aisles: DxfRect[];
  walls: DxfSegment[];
  warnings: string[];
}

export interface CsvImportResult {
  created: number;
  updated: number;
  errors: string[];
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  product_id: number | null;
  read: boolean;
  created_at: string;
}

export interface AskResponse {
  ai_available: boolean;
  question: string;
  interpretation: string | null;
  columns: string[];
  rows: Record<string, unknown>[];
  location_ids: number[];
  error: string | null;
}

export interface SlottingSuggestion {
  location_id: number;
  code: string;
  score: number;
  reason: string;
}

export interface SlottingResponse {
  ai_available: boolean;
  suggestions: SlottingSuggestion[];
  explanation: string;
}

export interface SummaryResponse {
  ai_available: boolean;
  summary: string;
  anomalies: string[];
}

export interface WarehouseSummary {
  warehouse_id: number;
  warehouse_name: string;
  zone_count: number;
  rack_count: number;
  bin_count: number;
  used_bin_count: number;
  total_quantity: number;
  occupancy_percent: number;
}

export interface StockByLocationRow {
  location_id: number;
  code: string;
  type: string;
  total_quantity: number;
  product_count: number;
}

export interface OccupancyRow {
  location_id: number;
  code: string;
  type: string;
  capacity: number;
  quantity: number;
  occupancy_percent: number;
}

export interface LowStockRow {
  product_id: number;
  sku: string;
  name: string;
  unit: string;
  min_stock_threshold: number;
  total_quantity: number;
}

export interface MoverRow {
  product_id: number;
  sku: string;
  name: string;
  movement_count: number;
  total_moved: number;
}

export interface MovementHistoryPoint {
  day: string;
  receive: number;
  pick: number;
  transfer: number;
  adjust: number;
}

export interface Region {
  id: number;
  name: string;
  ring: LatLng[];
  created_at: string;
}

export interface RegionWarehouseRow {
  warehouse_id: number;
  warehouse_name: string;
  address: string | null;
  location: LatLng;
  zone_count: number;
  rack_count: number;
  bin_count: number;
  used_bin_count: number;
  total_quantity: number;
  occupancy_percent: number;
  distance_to_centroid_m: number;
}

export interface RegionAnalysis {
  area_m2: number;
  centroid: LatLng;
  warehouse_count: number;
  total_quantity: number;
  total_bins: number;
  used_bins: number;
  occupancy_percent: number;
  low_stock_product_count: number;
  max_pairwise_distance_m: number;
  warehouses: RegionWarehouseRow[];
}

export interface Customer {
  id: number;
  name: string;
  location: LatLng;
  weight: number;
  city: string | null;
  created_at: string;
}

export interface DemandPoint {
  id: number;
  name: string;
  location: LatLng;
  weight: number;
}

export interface ProposedSite {
  location: LatLng;
  assigned_customers: number;
  assigned_weight: number;
}

export interface AssignmentLine {
  customer_id: number;
  from_location: LatLng;
  to_location: LatLng;
  weight: number;
  distance_m: number;
}

export interface CenterOfGravity {
  n_sites: number;
  proposed_sites: ProposedSite[];
  assignments: AssignmentLine[];
  current_total_weighted_km: number;
  proposed_total_weighted_km: number;
  improvement_percent: number;
}

export interface FacilityLoad {
  warehouse_id: number;
  warehouse_name: string;
  location: LatLng;
  customer_count: number;
  total_weight: number;
  avg_distance_km: number;
}

export interface ClosestFacility {
  assignments: AssignmentLine[];
  loads: FacilityLoad[];
  territories: { warehouse_id: number; ring: LatLng[] }[];
}

export interface CoverageBand {
  radius_km: number;
  ring: LatLng[];
  customer_count: number;
  covered_weight: number;
}

export interface WarehouseCoverage {
  warehouse_id: number;
  warehouse_name: string;
  bands: CoverageBand[];
  isochrones: { minutes: number; geometry: GeoJSON.Geometry }[] | null;
}

export interface Coverage {
  mode: "rings" | "isochrone";
  note: string;
  warehouses: WarehouseCoverage[];
  uncovered_customers: number;
  uncovered_weight: number;
}

export interface FlowArc {
  from_warehouse_id: number;
  from_name: string;
  from_location: LatLng;
  to_warehouse_id: number;
  to_name: string;
  to_location: LatLng;
  total_quantity: number;
  transfer_count: number;
}

export interface PickStop {
  order: number;
  location_id: number;
  code: string;
  x: number;
  y: number;
  product_sku: string | null;
  quantity: number | null;
}

export interface PolicyRoute {
  policy: "s_shape" | "largest_gap" | "optimized";
  total_m: number;
  stops: PickStop[];
  path: { x: number; y: number }[];
}

export interface PickRoute {
  warehouse_id: number;
  pick_count: number;
  routes: PolicyRoute[];
  best_policy: string;
}

/* ── Faz 4: teslimat turları, canlı takip, senaryo, tahmin, KPI, sipariş ── */

export interface TourStop {
  customer_id: number;
  name: string;
  location: LatLng;
  demand: number;
  service_min: number;
}

export interface Tour {
  vehicle_name: string;
  stops: TourStop[];
  distance_km: number;
  duration_min: number;
  load: number;
}

export interface VehicleRoutes {
  warehouse_id: number;
  vehicle_count: number;
  capacity: number;
  tours: Tour[];
  total_km: number;
  unassigned_customers: number;
  note: string;
}

export interface VehicleLive {
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
  elapsed_sim_min: number;
}

export interface Shipment {
  id: number;
  warehouse_id: number;
  vehicle_name: string;
  total_km: number;
  total_min: number;
  time_scale: number;
  depart_at: string;
  stop_count: number;
  live: VehicleLive;
  route: LatLng[];
}

export interface ShipmentStopEta {
  customer_id: number;
  name: string;
  location: LatLng;
  demand: number;
  status: "done" | "current" | "pending";
  eta_min: number | null;
  planned_arrive_min: number;
}

export interface ShipmentDetail extends Shipment {
  stops: ShipmentStopEta[];
}

export interface ScenarioSide {
  total_weighted_km: number;
  avg_distance_km: number;
  uncovered_customers: number;
  loads: {
    warehouse_id: number;
    warehouse_name: string;
    customer_count: number;
    total_weight: number;
  }[];
}

export interface ScenarioResult {
  closed_warehouse_ids: number[];
  baseline: ScenarioSide;
  scenario: ScenarioSide;
  delta_weighted_km: number;
  delta_percent: number;
  reassigned_customers: number;
}

export interface ForecastPoint {
  day: string;
  quantity: number;
  kind: "actual" | "forecast";
}

export interface ProductForecast {
  product_id: number;
  sku: string;
  name: string;
  current_stock: number;
  daily_avg: number;
  daily_std: number;
  reorder_point: number;
  days_until_stockout: number | null;
  series: ForecastPoint[];
}

export interface ReorderSuggestion {
  product_id: number;
  sku: string;
  name: string;
  current_stock: number;
  reorder_point: number;
  days_until_stockout: number | null;
  suggested_order_qty: number;
}

export interface Kpi {
  inventory_turnover_30d: number;
  outbound_units_30d: number;
  inbound_units_30d: number;
  movements_per_day_7d: number;
  occupancy_percent: number;
  active_alert_products: number;
  open_orders: number;
  active_shipments: number;
  busiest_product_sku: string | null;
}

export interface OrderLine {
  product_id: number;
  sku: string;
  product_name: string;
  quantity: number;
}

export interface CustomerOrder {
  id: number;
  code: string;
  warehouse_id: number;
  customer_name: string;
  status: "open" | "waved" | "picked";
  created_at: string;
  lines: OrderLine[];
}

export interface WaveLine {
  product_id: number;
  sku: string;
  product_name: string;
  total_quantity: number;
  location_id: number | null;
  location_code: string | null;
}

export interface WavePick {
  order_ids: number[];
  warehouse_id: number;
  lines: WaveLine[];
  route: PickRoute | null;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details: unknown;
  };
}
