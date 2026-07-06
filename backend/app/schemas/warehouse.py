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
    bearing_deg: float = Field(default=0.0, ge=-360, le=360)


class WarehouseUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    address: str | None = Field(default=None, max_length=500)
    location: LatLng | None = None
    local_width: float | None = Field(default=None, gt=0, le=2000)
    local_depth: float | None = Field(default=None, gt=0, le=2000)
    bearing_deg: float | None = Field(default=None, ge=-360, le=360)


class LevelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ordinal: int
    name: str
    base_elevation_m: float


class WarehouseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    address: str | None
    location: LatLng
    footprint: list[LatLng] | None = None
    local_width: float
    local_depth: float
    # Grid-north's clockwise deviation from true north — georeferences the
    # interior meter frame onto the map at its real orientation.
    bearing_deg: float = 0.0
    created_at: datetime


class WarehouseStatsOut(WarehouseOut):
    location_count: int = 0
    bin_count: int = 0
    product_count: int = 0
    total_quantity: int = 0
    occupancy_percent: float | None = None
