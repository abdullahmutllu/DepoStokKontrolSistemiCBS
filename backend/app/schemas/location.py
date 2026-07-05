from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

LocationType = Literal["zone", "aisle", "rack", "shelf", "bin"]


class LocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    warehouse_id: int
    parent_id: int | None
    type: str
    code: str
    label: str | None
    pos_x: float
    pos_y: float
    pos_z: float
    dim_w: float
    dim_d: float
    dim_h: float
    rotation: float
    capacity: int | None
    meta: dict[str, Any] | None


class BinStockOut(BaseModel):
    product_id: int
    sku: str
    product_name: str
    unit: str
    quantity: int


class LocationDetailOut(LocationOut):
    stock: list[BinStockOut] = []
    total_quantity: int = 0


class Bin3DOut(BaseModel):
    """Flat bin payload for the 3D scene: geometry + occupancy in one item."""

    id: int
    code: str
    pos_x: float
    pos_y: float
    pos_z: float
    dim_w: float
    dim_d: float
    dim_h: float
    rotation: float
    capacity: int | None
    quantity: int
    movement_count: int = 0  # son 30 gün, giriş+çıkış toplamı (hareket/ABC modu)
    # Gözdeki bir ürünün org geneli stoğu eşiğin altındaysa "critical",
    # eşiğin 1.5 katının altındaysa "warning" — 3B uyarı pinleri bunu çizer.
    alert: str | None = None


class Layout3DOut(BaseModel):
    warehouse_id: int
    local_width: float
    local_depth: float
    zones: list[LocationOut]
    aisles: list[LocationOut]
    racks: list[LocationOut]
    shelves: list[LocationOut]
    bins: list[Bin3DOut]


class RackPlacement(BaseModel):
    col: int = Field(ge=0)
    row: int = Field(ge=0)
    # Generous caps: the DXF path converts meter rects on a 1 cm grid, so a
    # 20 m rack is 2000 cells. Warehouse-bounds validation is the real guard.
    w_cells: int = Field(ge=1, le=2000)
    d_cells: int = Field(ge=1, le=2000)
    rotation: float = 0.0
    shelf_count: int = Field(ge=1, le=20)
    bins_per_shelf: int = Field(ge=1, le=50)
    shelf_height: float = Field(default=1.5, gt=0, le=10)
    bin_capacity: int | None = Field(default=100, ge=1)


class LayoutGenerateRequest(BaseModel):
    zone_code: str | None = None  # default: next Z index
    zone_label: str | None = None
    cell_size: float = Field(default=0.5, gt=0, le=10)
    racks: list[RackPlacement] = Field(min_length=1)


class LayoutGenerateResult(BaseModel):
    zone_id: int
    zone_code: str
    created_aisles: int
    created_racks: int
    created_shelves: int
    created_bins: int
    sample_codes: list[str]
