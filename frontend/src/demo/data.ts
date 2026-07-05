/** In-browser demo "database": deterministic dataset + mutable state.
 *
 * Everything the mocked API serves is derived from this module, so stock
 * operations done by a visitor (receive/pick/transfer) update the 3D scene,
 * reports and movements exactly like the real backend would — but the data
 * never leaves the browser tab.
 */

import type {
  AppNotification,
  Bin3D,
  LatLng,
  Movement,
  Product,
  Region,
  StorageLocation,
  User,
  Warehouse,
} from "@/types";

/* deterministic PRNG so every visitor sees the same warehouse */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260705);

export const demoUser: User = { id: 1, org_id: 1, email: "owner@demo.co", role: "owner" };
export const DEMO_TOKEN = "demo-token";

/* ── warehouses ─────────────────────────────────────────────────────────── */

interface WarehouseSpec {
  id: number;
  name: string;
  address: string;
  location: LatLng;
  w: number;
  d: number;
  rackRows: number;
  shelves: number;
  binsPerShelf: number;
}

const SPECS: WarehouseSpec[] = [
  { id: 1, name: "İstanbul Ana Depo", address: "İkitelli OSB, Başakşehir/İstanbul", location: { lat: 41.06, lng: 28.79 }, w: 40, d: 25, rackRows: 4, shelves: 3, binsPerShelf: 8 },
  { id: 2, name: "Ankara Bölge Deposu", address: "OSTİM OSB, Yenimahalle/Ankara", location: { lat: 39.97, lng: 32.75 }, w: 25, d: 18, rackRows: 3, shelves: 2, binsPerShelf: 6 },
  { id: 3, name: "İzmir Dağıtım Merkezi", address: "Atatürk OSB, Çiğli/İzmir", location: { lat: 38.48, lng: 27.05 }, w: 30, d: 20, rackRows: 3, shelves: 2, binsPerShelf: 7 },
];

export const warehouses: Warehouse[] = SPECS.map((s) => ({
  id: s.id,
  name: s.name,
  address: s.address,
  location: s.location,
  footprint: null,
  local_width: s.w,
  local_depth: s.d,
  created_at: "2026-01-10T09:00:00Z",
}));

/* ── layout generation (Z1-A{a}-R{r}-S{s}-B{b} hierarchy) ───────────────── */

export const locations: StorageLocation[] = [];
export const binsByWarehouse = new Map<number, StorageLocation[]>();

function generateLayout(spec: WarehouseSpec) {
  let nextId = spec.id * 10_000;
  const mk = (
    partial: Omit<StorageLocation, "id" | "warehouse_id" | "label" | "meta" | "rotation">,
  ): StorageLocation => {
    const loc: StorageLocation = {
      id: ++nextId,
      warehouse_id: spec.id,
      label: null,
      meta: null,
      rotation: 0,
      ...partial,
    };
    locations.push(loc);
    return loc;
  };

  const bins: StorageLocation[] = [];
  const rackW = spec.binsPerShelf; // 1 m bins
  const rackD = 1.2;
  const gap = 3.4; // aisle between rack rows
  const originX = 2;
  const zoneD = spec.rackRows * (rackD + gap);
  const zone = mk({
    parent_id: null, type: "zone", code: "Z1",
    pos_x: originX - 0.6, pos_y: 1.4, pos_z: 0,
    dim_w: rackW + 1.2, dim_d: zoneD, dim_h: 0, capacity: null,
  });

  for (let r = 0; r < spec.rackRows; r++) {
    const rowY = 2 + r * (rackD + gap);
    const aisle = mk({
      parent_id: zone.id, type: "aisle", code: `Z1-A${r + 1}`,
      pos_x: originX, pos_y: rowY + rackD, pos_z: 0,
      dim_w: rackW, dim_d: gap - 0.6, dim_h: 0, capacity: null,
    });
    const rack = mk({
      parent_id: aisle.id, type: "rack", code: `Z1-A${r + 1}-R1`,
      pos_x: originX, pos_y: rowY, pos_z: 0,
      dim_w: rackW, dim_d: rackD, dim_h: spec.shelves * 1.5, capacity: null,
    });
    for (let s = 0; s < spec.shelves; s++) {
      const shelf = mk({
        parent_id: rack.id, type: "shelf", code: `${rack.code}-S${s + 1}`,
        pos_x: rack.pos_x, pos_y: rack.pos_y, pos_z: s * 1.5,
        dim_w: rack.dim_w, dim_d: rack.dim_d, dim_h: 1.5, capacity: null,
      });
      for (let b = 0; b < spec.binsPerShelf; b++) {
        bins.push(
          mk({
            parent_id: shelf.id, type: "bin", code: `${shelf.code}-B${b + 1}`,
            pos_x: rack.pos_x + b, pos_y: rack.pos_y, pos_z: s * 1.5,
            dim_w: 1, dim_d: rackD, dim_h: 1.5, capacity: 120,
          }),
        );
      }
    }
  }
  binsByWarehouse.set(spec.id, bins);
}
SPECS.forEach(generateLayout);

/** Layout builder for warehouses created inside the demo session. */
export function addLayout(
  warehouseId: number,
  rackRows: number,
  shelves: number,
  binsPerShelf: number,
) {
  const existing = binsByWarehouse.get(warehouseId);
  if (existing && existing.length > 0) return existing; // demo: tek yerleşim
  const wh = warehouses.find((w) => w.id === warehouseId)!;
  generateLayout({
    id: warehouseId,
    name: wh.name,
    address: wh.address ?? "",
    location: wh.location,
    w: wh.local_width,
    d: wh.local_depth,
    rackRows,
    shelves,
    binsPerShelf,
  });
  return binsByWarehouse.get(warehouseId) ?? [];
}

/* ── products ───────────────────────────────────────────────────────────── */

const PRODUCT_SPECS: [string, string, string, number][] = [
  ["RLM-6204", "Rulman 6204 2RS", "adet", 50],
  ["CVT-M20", "Cıvata M20 Galvanizli (100'lük)", "kutu", 40],
  ["SGR-C16", "Otomatik Sigorta C16", "adet", 30],
  ["PLT-EUR", "Euro Palet 80x120", "adet", 20],
  ["BNT-120", "Koli Bandı 120 m", "rulo", 25],
  ["KBL-325", "NYA Kablo 3x2.5 (100 m)", "makara", 15],
  ["MTR-055", "Redüktörlü Motor 0.55 kW", "adet", 8],
  ["FLT-HYD", "Hidrolik Filtre Elemanı", "adet", 12],
  ["VNA-DN50", "Küresel Vana DN50", "adet", 10],
  ["YTK-6204", "Rulman Yatağı UCP-204", "adet", 0],
  ["ELD-NIT", "Nitril Eldiven (Koli)", "koli", 60],
  ["YAG-H46", "Hidrolik Yağ H46 (Varil)", "varil", 10],
  ["SNS-IND", "Endüktif Sensör M18", "adet", 25],
  ["PRJ-100", "LED Projektör 100 W", "adet", 0],
];

export const products: Product[] = PRODUCT_SPECS.map(([sku, name, unit, threshold], i) => ({
  id: i + 1,
  sku,
  name,
  description: null,
  unit,
  barcode: `869${String(1000000 + i * 733)}`,
  dim_w: null,
  dim_d: null,
  dim_h: null,
  min_stock_threshold: threshold,
  image_url: null,
  created_at: "2026-01-12T10:00:00Z",
}));

/* ── stock state (mutable) ──────────────────────────────────────────────── */

/** `${productId}:${locationId}` → quantity */
export const stock = new Map<string, number>();

function put(productId: number, locationId: number, qty: number) {
  const key = `${productId}:${locationId}`;
  stock.set(key, (stock.get(key) ?? 0) + qty);
}

// Seed: ~45% of bins filled; PLT-EUR kept critical, BNT-120 kept at warning level.
for (const [whId, bins] of binsByWarehouse) {
  for (const bin of bins) {
    if (rng() > 0.45) continue;
    const productIdx = Math.floor(rng() * products.length);
    const product = products[productIdx];
    if (product.sku === "PLT-EUR" || product.sku === "BNT-120") continue; // hand-seeded below
    const qty = 10 + Math.floor(rng() * 110);
    put(product.id, bin.id, qty);
  }
  void whId;
}
// hand-seeded alert cases (in İstanbul + Ankara)
const pltEur = products.find((p) => p.sku === "PLT-EUR")!;
const bnt = products.find((p) => p.sku === "BNT-120")!;
put(pltEur.id, binsByWarehouse.get(2)![3].id, 5); // total 5 ≤ 20 → critical
put(bnt.id, binsByWarehouse.get(1)![10].id, 18);
put(bnt.id, binsByWarehouse.get(1)![40].id, 12); // total 30 ≤ 37.5 → warning

export function productTotal(productId: number): number {
  let total = 0;
  for (const [key, qty] of stock) {
    if (key.startsWith(`${productId}:`)) total += qty;
  }
  return total;
}

export function binQuantity(locationId: number): number {
  let total = 0;
  for (const [key, qty] of stock) {
    if (key.endsWith(`:${locationId}`)) total += qty;
  }
  return total;
}

export function binStockRows(locationId: number) {
  const rows: { product_id: number; sku: string; product_name: string; unit: string; quantity: number }[] = [];
  for (const [key, qty] of stock) {
    if (!key.endsWith(`:${locationId}`) || qty <= 0) continue;
    const productId = Number(key.split(":")[0]);
    const p = products.find((x) => x.id === productId)!;
    rows.push({ product_id: p.id, sku: p.sku, product_name: p.name, unit: p.unit, quantity: qty });
  }
  return rows.sort((a, b) => a.sku.localeCompare(b.sku));
}

export const locationById = (id: number) => locations.find((l) => l.id === id);
export const warehouseOf = (loc: StorageLocation) => warehouses.find((w) => w.id === loc.warehouse_id)!;

/* ── movements (mutable) ────────────────────────────────────────────────── */

export const movements: Movement[] = [];
let movementId = 0;

export function recordMovement(
  type: Movement["type"],
  productId: number,
  fromLocationId: number | null,
  toLocationId: number | null,
  quantity: number,
  note: string | null,
  createdAt?: string,
) {
  const p = products.find((x) => x.id === productId)!;
  movements.unshift({
    id: ++movementId,
    product_id: productId,
    from_location_id: fromLocationId,
    to_location_id: toLocationId,
    type,
    quantity,
    user_id: demoUser.id,
    note,
    created_at: createdAt ?? new Date().toISOString(),
    product_sku: p.sku,
    product_name: p.name,
    from_code: fromLocationId ? locationById(fromLocationId)?.code ?? null : null,
    to_code: toLocationId ? locationById(toLocationId)?.code ?? null : null,
    user_email: demoUser.email,
  });
}

// Seed 14 days of history (receives, picks, transfers — incl. inter-warehouse).
{
  const now = Date.now();
  const istBins = binsByWarehouse.get(1)!;
  const ankBins = binsByWarehouse.get(2)!;
  const izmBins = binsByWarehouse.get(3)!;
  for (let day = 13; day >= 0; day--) {
    const n = 2 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const t = new Date(now - day * 86_400_000 - Math.floor(rng() * 8) * 3_600_000).toISOString();
      const p = products[Math.floor(rng() * products.length)];
      const roll = rng();
      if (roll < 0.45) {
        recordMovement("receive", p.id, null, istBins[Math.floor(rng() * istBins.length)].id, 5 + Math.floor(rng() * 40), null, t);
      } else if (roll < 0.8) {
        recordMovement("pick", p.id, istBins[Math.floor(rng() * istBins.length)].id, null, 1 + Math.floor(rng() * 15), null, t);
      } else {
        const from = istBins[Math.floor(rng() * istBins.length)];
        const to = (rng() < 0.5 ? ankBins : izmBins)[Math.floor(rng() * 20)];
        recordMovement("transfer", p.id, from.id, to.id, 5 + Math.floor(rng() * 25), "Bölge sevkiyatı", t);
      }
    }
  }
}

/* ── alerts + layout-3d assembly ────────────────────────────────────────── */

export interface BinAlertInfo {
  level: "critical" | "warning";
  sku: string;
  total: number;
  threshold: number;
}

export function binAlertInfo(locationId: number): BinAlertInfo | null {
  let worst: BinAlertInfo | null = null;
  for (const [key, qty] of stock) {
    if (!key.endsWith(`:${locationId}`) || qty <= 0) continue;
    const p = products.find((x) => x.id === Number(key.split(":")[0]))!;
    if (p.min_stock_threshold <= 0) continue;
    const total = productTotal(p.id);
    const info = { sku: p.sku, total, threshold: p.min_stock_threshold };
    if (total <= p.min_stock_threshold) return { level: "critical", ...info };
    if (total <= p.min_stock_threshold * 1.5) worst = { level: "warning", ...info };
  }
  return worst;
}

export function binMovementCount(locationId: number): number {
  const since = Date.now() - 30 * 86_400_000;
  return movements.filter(
    (m) =>
      new Date(m.created_at).getTime() >= since &&
      (m.from_location_id === locationId || m.to_location_id === locationId),
  ).length;
}

export function layout3d(warehouseId: number) {
  const wh = warehouses.find((w) => w.id === warehouseId)!;
  const whLocs = locations.filter((l) => l.warehouse_id === warehouseId);
  const bins: Bin3D[] = (binsByWarehouse.get(warehouseId) ?? []).map((b) => {
    const alert = binAlertInfo(b.id);
    return {
      id: b.id,
      code: b.code,
      pos_x: b.pos_x,
      pos_y: b.pos_y,
      pos_z: b.pos_z,
      dim_w: b.dim_w,
      dim_d: b.dim_d,
      dim_h: b.dim_h,
      rotation: b.rotation,
      capacity: b.capacity,
      quantity: binQuantity(b.id),
      movement_count: binMovementCount(b.id),
      alert: alert?.level ?? null,
      alert_sku: alert?.sku ?? null,
      alert_total: alert?.total ?? null,
      alert_threshold: alert?.threshold ?? null,
    };
  });
  return {
    warehouse_id: warehouseId,
    local_width: wh.local_width,
    local_depth: wh.local_depth,
    zones: whLocs.filter((l) => l.type === "zone"),
    aisles: whLocs.filter((l) => l.type === "aisle"),
    racks: whLocs.filter((l) => l.type === "rack"),
    shelves: whLocs.filter((l) => l.type === "shelf"),
    bins,
  };
}

/* ── customers / demand points ──────────────────────────────────────────── */

const CUSTOMER_SPECS: [string, number, number, number][] = [
  ["İstanbul Perakende", 41.01, 28.97, 25],
  ["Ankara Bayi", 39.92, 32.85, 18],
  ["İzmir Market", 38.42, 27.14, 15],
  ["Bursa Sanayi", 40.19, 29.06, 12],
  ["Antalya Dağıtım", 36.89, 30.71, 10],
  ["Adana Toptan", 37.0, 35.32, 9],
  ["Konya Bayi", 37.87, 32.49, 8],
  ["Gaziantep Depo Müşterisi", 37.07, 37.38, 8],
  ["Kayseri OSB", 38.73, 35.48, 7],
  ["Mersin Liman", 36.8, 34.63, 7],
  ["Eskişehir Sanayi", 39.77, 30.52, 6],
  ["Samsun Bayi", 41.28, 36.33, 6],
  ["Denizli Tekstil", 37.78, 29.09, 5],
  ["Trabzon Market", 41.0, 39.72, 5],
  ["Diyarbakır Bayi", 37.91, 40.24, 5],
  ["Kocaeli Lojistik", 40.85, 29.88, 5],
  ["Sakarya Bayi", 40.77, 30.4, 4],
  ["Tekirdağ Depo", 40.98, 27.51, 4],
  ["Balıkesir Market", 39.65, 27.89, 3],
  ["Manisa OSB", 38.62, 27.43, 3],
  ["Aydın Bayi", 37.85, 27.85, 3],
  ["Malatya Dağıtım", 38.35, 38.31, 3],
  ["Erzurum Bayi", 39.9, 41.27, 2],
  ["Van Market", 38.49, 43.38, 2],
];

export const customers = CUSTOMER_SPECS.map(([name, lat, lng, weight], i) => ({
  id: i + 1,
  name,
  location: { lat, lng },
  weight,
  city: name.split(" ")[0],
  created_at: "2026-02-01T08:00:00Z",
}));

/* ── notifications & regions (mutable) ──────────────────────────────────── */

export const notifications: AppNotification[] = [
  {
    id: 1, type: "low_stock", title: "Düşük stok: PLT-EUR",
    message: "Euro Palet 80x120 stoğu eşiğin altında (5/20).",
    product_id: pltEur.id, read: false,
    created_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
  {
    id: 2, type: "low_stock", title: "Stok uyarısı: BNT-120",
    message: "Koli Bandı 120 m eşiğe yaklaşıyor (30/25 eşik).",
    product_id: bnt.id, read: false,
    created_at: new Date(Date.now() - 26 * 3_600_000).toISOString(),
  },
  {
    id: 3, type: "info", title: "Demo modu",
    message: "Bu ortam tarayıcınızda çalışır; veriler sayfa yenilenince sıfırlanır.",
    product_id: null, read: true,
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
];

export const regions: Region[] = [
  {
    id: 1,
    name: "Marmara Sahası",
    ring: [
      { lat: 40.2, lng: 26.5 },
      { lat: 40.2, lng: 30.6 },
      { lat: 41.7, lng: 30.6 },
      { lat: 41.7, lng: 26.5 },
    ],
    created_at: "2026-03-01T09:00:00Z",
  },
];

let regionId = 1;
export const nextRegionId = () => ++regionId;
let warehouseIdSeq = SPECS.length;
export const nextWarehouseId = () => ++warehouseIdSeq;
let productIdSeq = products.length;
export const nextProductId = () => ++productIdSeq;
let notifIdSeq = notifications.length;
export const nextNotificationId = () => ++notifIdSeq;
