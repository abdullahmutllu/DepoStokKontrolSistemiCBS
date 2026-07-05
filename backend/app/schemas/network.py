from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.warehouse import LatLng

# ── Customers (demand points) ────────────────────────────────────────────────


class CustomerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    location: LatLng
    weight: int = Field(default=1, ge=1, le=1000)
    city: str | None = Field(default=None, max_length=100)


class CustomerUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    location: LatLng | None = None
    weight: int | None = Field(default=None, ge=1, le=1000)
    city: str | None = Field(default=None, max_length=100)


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    location: LatLng
    weight: int
    city: str | None
    created_at: datetime


# ── Network analysis outputs ─────────────────────────────────────────────────


class DemandPoint(BaseModel):
    id: int
    name: str
    location: LatLng
    weight: int


class ProposedSite(BaseModel):
    location: LatLng
    assigned_customers: int
    assigned_weight: int


class AssignmentLine(BaseModel):
    customer_id: int
    from_location: LatLng
    to_location: LatLng
    weight: int
    distance_m: float


class CenterOfGravityOut(BaseModel):
    n_sites: int
    proposed_sites: list[ProposedSite]
    assignments: list[AssignmentLine]
    current_total_weighted_km: float
    proposed_total_weighted_km: float
    improvement_percent: float


class FacilityLoad(BaseModel):
    warehouse_id: int
    warehouse_name: str
    location: LatLng
    customer_count: int
    total_weight: int
    avg_distance_km: float


class ClosestFacilityOut(BaseModel):
    assignments: list[AssignmentLine]
    loads: list[FacilityLoad]
    # Voronoi territory polygons as rings (same wire convention as footprints)
    territories: list[dict[str, Any]]  # {warehouse_id, ring: [LatLng...]}


class CoverageBand(BaseModel):
    radius_km: float
    ring: list[LatLng]  # outer boundary of the band (approximate, for display)
    customer_count: int
    covered_weight: int


class WarehouseCoverage(BaseModel):
    warehouse_id: int
    warehouse_name: str
    bands: list[CoverageBand]
    # isochrone mode: raw GeoJSON geometries per minute band
    isochrones: list[dict[str, Any]] | None = None


class CoverageOut(BaseModel):
    mode: Literal["rings", "isochrone"]
    note: str
    warehouses: list[WarehouseCoverage]
    uncovered_customers: int
    uncovered_weight: int


class FlowArc(BaseModel):
    from_warehouse_id: int
    from_name: str
    from_location: LatLng
    to_warehouse_id: int
    to_name: str
    to_location: LatLng
    total_quantity: int
    transfer_count: int


class FlowMapOut(BaseModel):
    arcs: list[FlowArc]


# ── Picker routing ───────────────────────────────────────────────────────────


class PickItem(BaseModel):
    product_id: int
    quantity: int = Field(default=1, ge=1)


class PickRouteRequest(BaseModel):
    items: list[PickItem] | None = None
    location_ids: list[int] | None = Field(default=None, max_length=60)


class PathPoint(BaseModel):
    x: float
    y: float


class PickStop(BaseModel):
    order: int
    location_id: int
    code: str
    x: float
    y: float
    product_sku: str | None = None
    quantity: int | None = None


class PolicyRoute(BaseModel):
    policy: Literal["s_shape", "largest_gap", "optimized"]
    total_m: float
    stops: list[PickStop]
    path: list[PathPoint]


class PickRouteOut(BaseModel):
    warehouse_id: int
    pick_count: int
    routes: list[PolicyRoute]
    best_policy: str
