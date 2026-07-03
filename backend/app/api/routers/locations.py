from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Product, StockItem, StorageLocation, User
from app.schemas.location import (
    Bin3DOut,
    BinStockOut,
    Layout3DOut,
    LocationDetailOut,
    LocationOut,
)
from app.services.scoping import get_owned_location, get_owned_warehouse

router = APIRouter(tags=["locations"])


@router.get("/warehouses/{warehouse_id}/locations", response_model=list[LocationOut])
def list_locations(
    warehouse_id: int,
    type: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[LocationOut]:
    warehouse = get_owned_warehouse(db, user.org_id, warehouse_id)
    stmt = (
        select(StorageLocation)
        .where(StorageLocation.warehouse_id == warehouse.id)
        .order_by(StorageLocation.code)
    )
    if type is not None:
        stmt = stmt.where(StorageLocation.type == type)
    return [LocationOut.model_validate(loc) for loc in db.scalars(stmt).all()]


@router.get("/warehouses/{warehouse_id}/layout-3d", response_model=Layout3DOut)
def layout_3d(
    warehouse_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Layout3DOut:
    """Single payload for the 3D scene: geometry plus per-bin stock totals."""
    warehouse = get_owned_warehouse(db, user.org_id, warehouse_id)
    locations = db.scalars(
        select(StorageLocation)
        .where(StorageLocation.warehouse_id == warehouse.id)
        .order_by(StorageLocation.code)
    ).all()

    quantities = {
        row.location_id: row.total
        for row in db.execute(
            select(
                StockItem.location_id,
                func.coalesce(func.sum(StockItem.quantity), 0).label("total"),
            )
            .join(StorageLocation, StockItem.location_id == StorageLocation.id)
            .where(StorageLocation.warehouse_id == warehouse.id)
            .group_by(StockItem.location_id)
        ).all()
    }

    zones, aisles, racks, shelves, bins = [], [], [], [], []
    for loc in locations:
        if loc.type == "zone":
            zones.append(LocationOut.model_validate(loc))
        elif loc.type == "aisle":
            aisles.append(LocationOut.model_validate(loc))
        elif loc.type == "rack":
            racks.append(LocationOut.model_validate(loc))
        elif loc.type == "shelf":
            shelves.append(LocationOut.model_validate(loc))
        elif loc.type == "bin":
            bins.append(
                Bin3DOut(
                    id=loc.id,
                    code=loc.code,
                    pos_x=loc.pos_x,
                    pos_y=loc.pos_y,
                    pos_z=loc.pos_z,
                    dim_w=loc.dim_w,
                    dim_d=loc.dim_d,
                    dim_h=loc.dim_h,
                    rotation=loc.rotation,
                    capacity=loc.capacity,
                    quantity=quantities.get(loc.id, 0),
                )
            )

    return Layout3DOut(
        warehouse_id=warehouse.id,
        local_width=warehouse.local_width,
        local_depth=warehouse.local_depth,
        zones=zones,
        aisles=aisles,
        racks=racks,
        shelves=shelves,
        bins=bins,
    )


@router.get("/locations/{location_id}", response_model=LocationDetailOut)
def location_detail(
    location_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LocationDetailOut:
    loc = get_owned_location(db, user.org_id, location_id)
    rows = db.execute(
        select(
            Product.id,
            Product.sku,
            Product.name,
            Product.unit,
            StockItem.quantity,
        )
        .join(StockItem, StockItem.product_id == Product.id)
        .where(StockItem.location_id == loc.id, StockItem.quantity > 0)
        .order_by(Product.sku)
    ).all()
    stock = [
        BinStockOut(
            product_id=r.id, sku=r.sku, product_name=r.name, unit=r.unit, quantity=r.quantity
        )
        for r in rows
    ]
    return LocationDetailOut(
        **LocationOut.model_validate(loc).model_dump(),
        stock=stock,
        total_quantity=sum(s.quantity for s in stock),
    )
