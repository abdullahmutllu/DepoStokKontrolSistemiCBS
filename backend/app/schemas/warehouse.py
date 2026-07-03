from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class LatLng(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class WarehouseCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    location: LatLng
    local_width: float = Field(default=50.0, gt=0, le=2000)
    local_depth: float = Field(default=30.0, gt=0, le=2000)


class WarehouseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    location: LatLng | None = None
    local_width: float | None = Field(default=None, gt=0, le=2000)
    local_depth: float | None = Field(default=None, gt=0, le=2000)


class WarehouseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    address: str | None
    location: LatLng
    footprint: list[LatLng] | None = None
    local_width: float
    local_depth: float
    created_at: datetime


class WarehouseStatsOut(WarehouseOut):
    location_count: int = 0
    bin_count: int = 0
    product_count: int = 0
    total_quantity: int = 0
    occupancy_percent: float | None = None
