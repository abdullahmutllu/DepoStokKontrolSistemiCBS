"""Faz 4 şemaları: VRP teslimat turları, canlı sevkiyat takibi, what-if
senaryosu, talep tahmini, KPI panosu ve sipariş/dalga toplama."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.network import PickRouteOut
from app.schemas.warehouse import LatLng

# ── VRP: teslimat turları ────────────────────────────────────────────────────


class VehicleRoutesRequest(BaseModel):
    warehouse_id: int
    vehicle_count: int = Field(default=3, ge=1, le=8)
    capacity: int = Field(default=60, ge=1, le=10_000)  # talep birimi


class TourStopOut(BaseModel):
    customer_id: int
    name: str
    location: LatLng
    demand: int
    service_min: float


class TourOut(BaseModel):
    vehicle_name: str
    stops: list[TourStopOut]
    distance_km: float
    duration_min: float  # servis süreleri dahil, depoya dönüş dahil
    load: int


class VehicleRoutesOut(BaseModel):
    warehouse_id: int
    vehicle_count: int
    capacity: int
    tours: list[TourOut]
    total_km: float
    unassigned_customers: int  # kapasiteye sığmayanlar (varsa)
    note: str


# ── Canlı sevkiyat takibi ────────────────────────────────────────────────────


class ShipmentCreate(BaseModel):
    warehouse_id: int
    tours: list[TourOut]
    time_scale: float = Field(default=30.0, ge=1, le=240)
    base_speed_kmh: float = Field(default=65.0, ge=20, le=110)


class StopEta(BaseModel):
    customer_id: int
    name: str
    location: LatLng
    demand: int
    status: Literal["done", "current", "pending"]
    eta_min: float | None  # kalan simülasyon dakikası (done ise None)
    planned_arrive_min: float  # plan başından itibaren


class VehicleLive(BaseModel):
    """Aracın 'şu an'ki durumu — her istekte deterministik hesaplanır."""

    status: Literal["pending", "en_route", "at_stop", "completed"]
    position: LatLng
    heading_deg: float
    speed_kmh: float
    progress_percent: float
    completed_stops: int
    current_stop: str | None
    next_stop: str | None
    next_stop_eta_min: float | None
    next_stop_remaining_km: float | None
    eta_return_min: float
    elapsed_sim_min: float


class ShipmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    warehouse_id: int
    vehicle_name: str
    total_km: float
    total_min: float
    time_scale: float
    depart_at: datetime
    stop_count: int
    live: VehicleLive
    route: list[LatLng]  # depot → duraklar → depot (harita çizgisi)


class ShipmentDetailOut(ShipmentOut):
    stops: list[StopEta]


# ── What-if senaryosu ────────────────────────────────────────────────────────


class ScenarioRequest(BaseModel):
    closed_warehouse_ids: list[int] = Field(min_length=1)


class ScenarioSide(BaseModel):
    total_weighted_km: float
    avg_distance_km: float
    uncovered_customers: int  # 50 km dışı
    loads: list[dict]  # {warehouse_id, warehouse_name, customer_count, total_weight}


class ScenarioOut(BaseModel):
    closed_warehouse_ids: list[int]
    baseline: ScenarioSide
    scenario: ScenarioSide
    delta_weighted_km: float
    delta_percent: float  # + kötüleşme, - iyileşme
    reassigned_customers: int


# ── Talep tahmini ────────────────────────────────────────────────────────────


class ForecastPoint(BaseModel):
    day: str  # YYYY-MM-DD
    quantity: float
    kind: Literal["actual", "forecast"]


class ProductForecastOut(BaseModel):
    product_id: int
    sku: str
    name: str
    current_stock: int
    daily_avg: float
    daily_std: float
    reorder_point: int
    days_until_stockout: int | None
    series: list[ForecastPoint]  # 30 gün gerçek + 14 gün tahmin


class ReorderSuggestion(BaseModel):
    product_id: int
    sku: str
    name: str
    current_stock: int
    reorder_point: int
    days_until_stockout: int | None
    suggested_order_qty: int


# ── KPI panosu ───────────────────────────────────────────────────────────────


class KpiOut(BaseModel):
    inventory_turnover_30d: float  # 30 günlük çıkış / mevcut stok
    outbound_units_30d: int
    inbound_units_30d: int
    movements_per_day_7d: float
    occupancy_percent: float
    active_alert_products: int
    open_orders: int
    active_shipments: int
    busiest_product_sku: str | None


# ── Siparişler + dalga toplama ───────────────────────────────────────────────


class OrderLineIn(BaseModel):
    product_id: int
    quantity: int = Field(ge=1, le=10_000)


class OrderCreate(BaseModel):
    warehouse_id: int
    customer_name: str = Field(min_length=1, max_length=200)
    lines: list[OrderLineIn] = Field(min_length=1)


class OrderLineOut(BaseModel):
    product_id: int
    sku: str
    product_name: str
    quantity: int


class OrderOut(BaseModel):
    id: int
    code: str
    warehouse_id: int
    customer_name: str
    status: str
    created_at: datetime
    lines: list[OrderLineOut]


class WavePickRequest(BaseModel):
    order_ids: list[int] = Field(min_length=1)


class WaveLine(BaseModel):
    product_id: int
    sku: str
    product_name: str
    total_quantity: int
    location_id: int | None
    location_code: str | None


class WavePickOut(BaseModel):
    order_ids: list[int]
    warehouse_id: int
    lines: list[WaveLine]  # ürün bazında birleştirilmiş toplama listesi
    route: PickRouteOut | None  # gözler üzerinden optimize rota (çözülebilirse)
