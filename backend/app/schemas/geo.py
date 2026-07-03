from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.warehouse import LatLng


class RegionRing(BaseModel):
    """Wire format for user-drawn polygons: a lat/lng ring, same convention as
    WarehouseOut.footprint. Ring closure and vertex validation happen in
    geo.ring_to_polygon."""

    ring: list[LatLng] = Field(min_length=3, max_length=500)


class RegionWarehouseRow(BaseModel):
    warehouse_id: int
    warehouse_name: str
    address: str | None
    location: LatLng
    zone_count: int
    rack_count: int
    bin_count: int
    used_bin_count: int
    total_quantity: int
    occupancy_percent: float
    distance_to_centroid_m: float


class RegionAnalysisOut(BaseModel):
    area_m2: float
    centroid: LatLng
    warehouse_count: int
    total_quantity: int
    total_bins: int
    used_bins: int
    occupancy_percent: float
    low_stock_product_count: int
    max_pairwise_distance_m: float
    warehouses: list[RegionWarehouseRow]


class RegionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    ring: list[LatLng] = Field(min_length=3, max_length=500)


class RegionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    ring: list[LatLng] | None = Field(default=None, min_length=3, max_length=500)


class RegionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    ring: list[LatLng]
    created_at: datetime
