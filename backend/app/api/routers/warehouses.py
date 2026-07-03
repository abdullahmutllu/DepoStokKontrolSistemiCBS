from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import StockItem, StorageLocation, User, Warehouse
from app.schemas.warehouse import WarehouseCreate, WarehouseOut, WarehouseStatsOut, WarehouseUpdate
from app.services import geo
from app.services.scoping import get_owned_warehouse

router = APIRouter(prefix="/warehouses", tags=["warehouses"])


def _to_out(wh: Warehouse) -> WarehouseOut:
    return WarehouseOut(
        id=wh.id,
        name=wh.name,
        address=wh.address,
        location=geo.point_to_latlng(wh.location),
        footprint=geo.polygon_to_ring(wh.footprint),
        local_width=wh.local_width,
        local_depth=wh.local_depth,
        created_at=wh.created_at,
    )


def _stats_for(db: Session, warehouse_ids: list[int]) -> dict[int, dict]:
    if not warehouse_ids:
        return {}
    loc_rows = db.execute(
        select(
            StorageLocation.warehouse_id,
            func.count().label("location_count"),
            func.count().filter(StorageLocation.type == "bin").label("bin_count"),
            func.coalesce(
                func.sum(StorageLocation.capacity).filter(StorageLocation.type == "bin"), 0
            ).label("total_capacity"),
        )
        .where(StorageLocation.warehouse_id.in_(warehouse_ids))
        .group_by(StorageLocation.warehouse_id)
    ).all()
    stock_rows = db.execute(
        select(
            StorageLocation.warehouse_id,
            func.count(func.distinct(StockItem.product_id)).label("product_count"),
            func.coalesce(func.sum(StockItem.quantity), 0).label("total_quantity"),
        )
        .join(StorageLocation, StockItem.location_id == StorageLocation.id)
        .where(StorageLocation.warehouse_id.in_(warehouse_ids))
        .group_by(StorageLocation.warehouse_id)
    ).all()
    stats: dict[int, dict] = {}
    for row in loc_rows:
        stats.setdefault(row.warehouse_id, {})
        stats[row.warehouse_id].update(
            location_count=row.location_count,
            bin_count=row.bin_count,
            total_capacity=row.total_capacity,
        )
    for row in stock_rows:
        stats.setdefault(row.warehouse_id, {})
        stats[row.warehouse_id].update(
            product_count=row.product_count, total_quantity=row.total_quantity
        )
    return stats


@router.get("", response_model=list[WarehouseStatsOut])
def list_warehouses(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[WarehouseStatsOut]:
    warehouses = db.scalars(
        select(Warehouse).where(Warehouse.org_id == user.org_id).order_by(Warehouse.id)
    ).all()
    stats = _stats_for(db, [w.id for w in warehouses])
    out = []
    for wh in warehouses:
        s = stats.get(wh.id, {})
        capacity = s.get("total_capacity", 0) or 0
        quantity = s.get("total_quantity", 0) or 0
        out.append(
            WarehouseStatsOut(
                **_to_out(wh).model_dump(),
                location_count=s.get("location_count", 0),
                bin_count=s.get("bin_count", 0),
                product_count=s.get("product_count", 0),
                total_quantity=quantity,
                occupancy_percent=round(quantity / capacity * 100, 1) if capacity else None,
            )
        )
    return out


@router.post("", response_model=WarehouseOut, status_code=201)
def create_warehouse(
    payload: WarehouseCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WarehouseOut:
    wh = Warehouse(
        org_id=user.org_id,
        name=payload.name,
        address=payload.address,
        location=geo.latlng_to_point(payload.location),
        footprint=geo.footprint_polygon(payload.location, payload.local_width, payload.local_depth),
        local_width=payload.local_width,
        local_depth=payload.local_depth,
    )
    db.add(wh)
    db.flush()
    return _to_out(wh)


@router.get("/{warehouse_id}", response_model=WarehouseOut)
def get_warehouse(
    warehouse_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WarehouseOut:
    return _to_out(get_owned_warehouse(db, user.org_id, warehouse_id))


@router.patch("/{warehouse_id}", response_model=WarehouseOut)
def update_warehouse(
    warehouse_id: int,
    payload: WarehouseUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WarehouseOut:
    wh = get_owned_warehouse(db, user.org_id, warehouse_id)
    if payload.name is not None:
        wh.name = payload.name
    if payload.address is not None:
        wh.address = payload.address
    if payload.local_width is not None:
        wh.local_width = payload.local_width
    if payload.local_depth is not None:
        wh.local_depth = payload.local_depth
    if payload.location is not None:
        wh.location = geo.latlng_to_point(payload.location)
    dims_changed = payload.local_width is not None or payload.local_depth is not None
    if payload.location is not None or dims_changed:
        center = payload.location or geo.point_to_latlng(wh.location)
        wh.footprint = geo.footprint_polygon(center, wh.local_width, wh.local_depth)
    db.flush()
    return _to_out(wh)


@router.delete("/{warehouse_id}", status_code=204)
def delete_warehouse(
    warehouse_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    wh = get_owned_warehouse(db, user.org_id, warehouse_id)
    # Products may still reference movements; deleting a warehouse cascades its
    # locations (FK ondelete=CASCADE) and their stock items.
    db.delete(wh)
    db.flush()
