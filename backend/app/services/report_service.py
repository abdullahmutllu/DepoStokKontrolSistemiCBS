from datetime import UTC, datetime, timedelta

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import Product, StockItem, StockMovement, StorageLocation, Warehouse
from app.schemas.report import (
    LowStockRow,
    MovementHistoryPoint,
    MoverRow,
    OccupancyRow,
    StockByLocationRow,
    WarehouseSummaryOut,
)


def warehouse_summaries(
    db: Session, org_id: int, warehouse_ids: list[int] | None = None
) -> list[WarehouseSummaryOut]:
    stmt = select(Warehouse).where(Warehouse.org_id == org_id).order_by(Warehouse.id)
    if warehouse_ids is not None:
        stmt = stmt.where(Warehouse.id.in_(warehouse_ids or [0]))
    warehouses = db.scalars(stmt).all()
    out = []
    for wh in warehouses:
        counts = {
            row.type: row.count
            for row in db.execute(
                select(StorageLocation.type, func.count().label("count"))
                .where(StorageLocation.warehouse_id == wh.id)
                .group_by(StorageLocation.type)
            ).all()
        }
        stock = db.execute(
            select(
                func.count(func.distinct(StockItem.location_id)).filter(StockItem.quantity > 0),
                func.coalesce(func.sum(StockItem.quantity), 0),
            )
            .join(StorageLocation, StockItem.location_id == StorageLocation.id)
            .where(StorageLocation.warehouse_id == wh.id)
        ).one()
        capacity = db.scalar(
            select(func.coalesce(func.sum(StorageLocation.capacity), 0)).where(
                StorageLocation.warehouse_id == wh.id, StorageLocation.type == "bin"
            )
        )
        out.append(
            WarehouseSummaryOut(
                warehouse_id=wh.id,
                warehouse_name=wh.name,
                zone_count=counts.get("zone", 0),
                rack_count=counts.get("rack", 0),
                bin_count=counts.get("bin", 0),
                used_bin_count=stock[0] or 0,
                total_quantity=stock[1] or 0,
                occupancy_percent=round((stock[1] or 0) / capacity * 100, 1) if capacity else 0.0,
            )
        )
    return out


def stock_by_location(
    db: Session, org_id: int, warehouse_id: int, group_type: str = "zone"
) -> list[StockByLocationRow]:
    """Aggregate bin quantities up to their zone/aisle/rack ancestor by code prefix."""
    groups = db.scalars(
        select(StorageLocation)
        .join(Warehouse, StorageLocation.warehouse_id == Warehouse.id)
        .where(
            Warehouse.id == warehouse_id,
            Warehouse.org_id == org_id,
            StorageLocation.type == group_type,
        )
        .order_by(StorageLocation.code)
    ).all()
    rows = db.execute(
        select(
            StorageLocation.code,
            func.coalesce(func.sum(StockItem.quantity), 0).label("qty"),
            func.count(func.distinct(StockItem.product_id))
            .filter(StockItem.quantity > 0)
            .label("products"),
        )
        .join(StorageLocation, StockItem.location_id == StorageLocation.id)
        .where(StorageLocation.warehouse_id == warehouse_id)
        .group_by(StorageLocation.code)
    ).all()
    totals: dict[str, tuple[int, int]] = {r.code: (r.qty, r.products) for r in rows}

    out = []
    for group in groups:
        qty = sum(v[0] for code, v in totals.items() if code.startswith(group.code))
        products = sum(v[1] for code, v in totals.items() if code.startswith(group.code))
        out.append(
            StockByLocationRow(
                location_id=group.id,
                code=group.code,
                type=group.type,
                total_quantity=qty,
                product_count=products,
            )
        )
    return out


def occupancy(db: Session, org_id: int, warehouse_id: int) -> list[OccupancyRow]:
    rows = db.execute(
        select(
            StorageLocation.id,
            StorageLocation.code,
            StorageLocation.type,
            StorageLocation.capacity,
            func.coalesce(func.sum(StockItem.quantity), 0).label("qty"),
        )
        .join(Warehouse, StorageLocation.warehouse_id == Warehouse.id)
        .outerjoin(StockItem, StockItem.location_id == StorageLocation.id)
        .where(
            Warehouse.id == warehouse_id,
            Warehouse.org_id == org_id,
            StorageLocation.type == "bin",
            StorageLocation.capacity.isnot(None),
        )
        .group_by(
            StorageLocation.id, StorageLocation.code, StorageLocation.type,
            StorageLocation.capacity,
        )
        .order_by(StorageLocation.code)
    ).all()
    return [
        OccupancyRow(
            location_id=r.id,
            code=r.code,
            type=r.type,
            capacity=r.capacity,
            quantity=r.qty,
            occupancy_percent=round(r.qty / r.capacity * 100, 1) if r.capacity else 0.0,
        )
        for r in rows
    ]


def low_stock(db: Session, org_id: int) -> list[LowStockRow]:
    totals = (
        select(
            StockItem.product_id.label("product_id"),
            func.coalesce(func.sum(StockItem.quantity), 0).label("total"),
        )
        .group_by(StockItem.product_id)
        .subquery()
    )
    rows = db.execute(
        select(
            Product.id,
            Product.sku,
            Product.name,
            Product.unit,
            Product.min_stock_threshold,
            func.coalesce(totals.c.total, 0).label("total"),
        )
        .outerjoin(totals, totals.c.product_id == Product.id)
        .where(
            Product.org_id == org_id,
            Product.min_stock_threshold > 0,
            func.coalesce(totals.c.total, 0) < Product.min_stock_threshold,
        )
        .order_by(Product.sku)
    ).all()
    return [
        LowStockRow(
            product_id=r.id,
            sku=r.sku,
            name=r.name,
            unit=r.unit,
            min_stock_threshold=r.min_stock_threshold,
            total_quantity=r.total,
        )
        for r in rows
    ]


def top_movers(db: Session, org_id: int, days: int = 30, limit: int = 10, ascending: bool = False):
    since = datetime.now(UTC) - timedelta(days=days)
    order = func.count().asc() if ascending else func.count().desc()
    rows = db.execute(
        select(
            Product.id,
            Product.sku,
            Product.name,
            func.count().label("movement_count"),
            func.coalesce(func.sum(StockMovement.quantity), 0).label("total_moved"),
        )
        .join(StockMovement, StockMovement.product_id == Product.id)
        .where(Product.org_id == org_id, StockMovement.created_at >= since)
        .group_by(Product.id, Product.sku, Product.name)
        .order_by(order)
        .limit(limit)
    ).all()
    return [
        MoverRow(
            product_id=r.id,
            sku=r.sku,
            name=r.name,
            movement_count=r.movement_count,
            total_moved=r.total_moved,
        )
        for r in rows
    ]


def movement_history(db: Session, org_id: int, days: int = 14) -> list[MovementHistoryPoint]:
    since = datetime.now(UTC) - timedelta(days=days)
    day = func.date_trunc("day", StockMovement.created_at).label("day")
    rows = db.execute(
        select(
            day,
            func.coalesce(
                func.sum(case((StockMovement.type == "receive", StockMovement.quantity), else_=0)),
                0,
            ).label("receive"),
            func.coalesce(
                func.sum(case((StockMovement.type == "pick", StockMovement.quantity), else_=0)), 0
            ).label("pick"),
            func.coalesce(
                func.sum(
                    case((StockMovement.type == "transfer", StockMovement.quantity), else_=0)
                ),
                0,
            ).label("transfer"),
            func.coalesce(
                func.sum(
                    case(
                        (StockMovement.type.in_(("adjust", "count")), StockMovement.quantity),
                        else_=0,
                    )
                ),
                0,
            ).label("adjust"),
        )
        .where(StockMovement.org_id == org_id, StockMovement.created_at >= since)
        .group_by(day)
        .order_by(day)
    ).all()
    return [
        MovementHistoryPoint(
            day=r.day, receive=r.receive, pick=r.pick, transfer=r.transfer, adjust=r.adjust
        )
        for r in rows
    ]
