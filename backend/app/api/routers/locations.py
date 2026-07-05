from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Product, StockItem, StockMovement, StorageLocation, User
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

    # Movement heat: how many times each bin was touched in the last 30 days.
    # from/to sides counted separately so a transfer heats both ends.
    since = datetime.now(UTC) - timedelta(days=30)
    movement_counts: dict[int, int] = {}
    for col in (StockMovement.from_location_id, StockMovement.to_location_id):
        rows = db.execute(
            select(col, func.count().label("n"))
            .join(StorageLocation, col == StorageLocation.id)
            .where(
                StorageLocation.warehouse_id == warehouse.id,
                StockMovement.created_at >= since,
            )
            .group_by(col)
        ).all()
        for loc_id, n in rows:
            movement_counts[loc_id] = movement_counts.get(loc_id, 0) + n

    # Stock alerts: a bin inherits the worst state of the products it holds —
    # org-wide product total ≤ threshold → critical, ≤ 1.5×threshold → warning.
    holdings = db.execute(
        select(StockItem.location_id, Product.id, Product.sku, Product.min_stock_threshold)
        .join(Product, StockItem.product_id == Product.id)
        .join(StorageLocation, StockItem.location_id == StorageLocation.id)
        .where(
            StorageLocation.warehouse_id == warehouse.id,
            StockItem.quantity > 0,
            Product.min_stock_threshold > 0,
        )
    ).all()
    product_ids = {pid for _, pid, _, _ in holdings}
    org_totals = (
        {
            pid: total
            for pid, total in db.execute(
                select(StockItem.product_id, func.coalesce(func.sum(StockItem.quantity), 0))
                .where(StockItem.product_id.in_(product_ids))
                .group_by(StockItem.product_id)
            ).all()
        }
        if product_ids
        else {}
    )
    # loc_id → (level, sku, total, threshold); critical warning'i ezer.
    alerts: dict[int, tuple[str, str, int, int]] = {}
    for loc_id, pid, sku, threshold in holdings:
        total = org_totals.get(pid, 0)
        if total <= threshold:
            level = "critical"
        elif total <= threshold * 1.5:
            level = "warning"
        else:
            continue
        current = alerts.get(loc_id)
        if current is None or (current[0] != "critical" and level == "critical"):
            alerts[loc_id] = (level, sku, int(total), threshold)

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
                    movement_count=movement_counts.get(loc.id, 0),
                    alert=alerts[loc.id][0] if loc.id in alerts else None,
                    alert_sku=alerts[loc.id][1] if loc.id in alerts else None,
                    alert_total=alerts[loc.id][2] if loc.id in alerts else None,
                    alert_threshold=alerts[loc.id][3] if loc.id in alerts else None,
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
