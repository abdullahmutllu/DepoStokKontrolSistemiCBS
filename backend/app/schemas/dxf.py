from pydantic import BaseModel, Field

from app.schemas.location import LayoutGenerateResult


class DxfRect(BaseModel):
    x: float
    y: float
    w: float
    d: float
    rotation: float = 0.0


class DxfSegment(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class DxfPreview(BaseModel):
    units: str
    scale_applied: float
    bounds_w: float
    bounds_d: float
    racks: list[DxfRect]
    zones: list[DxfRect]
    aisles: list[DxfRect]
    walls: list[DxfSegment]
    warnings: list[str]


class DxfGenerateRequest(BaseModel):
    preview: DxfPreview
    zone_label: str | None = None
    shelf_count: int = Field(default=3, ge=1, le=20)
    bins_per_shelf: int = Field(default=4, ge=1, le=50)
    shelf_height: float = Field(default=1.5, gt=0, le=10)
    bin_capacity: int | None = Field(default=100, ge=1)


class DxfGenerateResult(LayoutGenerateResult):
    pass
