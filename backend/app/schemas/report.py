from datetime import datetime

from pydantic import BaseModel


class StockByLocationRow(BaseModel):
    location_id: int
    code: str
    type: str
    total_quantity: int
    product_count: int


class OccupancyRow(BaseModel):
    location_id: int
    code: str
    type: str
    capacity: int
    quantity: int
    occupancy_percent: float


class LowStockRow(BaseModel):
    product_id: int
    sku: str
    name: str
    unit: str
    min_stock_threshold: int
    total_quantity: int


class MoverRow(BaseModel):
    product_id: int
    sku: str
    name: str
    movement_count: int
    total_moved: int


class MovementHistoryPoint(BaseModel):
    day: datetime
    receive: int
    pick: int
    transfer: int
    adjust: int


class WarehouseSummaryOut(BaseModel):
    warehouse_id: int
    warehouse_name: str
    zone_count: int
    rack_count: int
    bin_count: int
    used_bin_count: int
    total_quantity: int
    occupancy_percent: float
