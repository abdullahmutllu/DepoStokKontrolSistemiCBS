"""Talep tahmini, yeniden sipariş önerileri ve KPI panosu."""

import math
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import (
    Order,
    Product,
    Shipment,
    StockItem,
    StockMovement,
    StorageLocation,
    User,
    Warehouse,
)
from app.schemas.logistics import (
    ForecastPoint,
    KpiOut,
    ProductForecastOut,
    ReorderSuggestion,
)
from app.services.forecast import (
    days_until_stockout,
    demand_stats,
    holt_forecast,
    reorder_point,
)
from app.services.scoping import get_owned_product

router = APIRouter(tags=["insights"])

HISTORY_DAYS = 30
HORIZON_DAYS = 14


def _daily_outflow(db: Session, org_id: int, product_id: int) -> list[float]:
    """Son 30 günün günlük çıkışı (pick adetleri); boş günler 0."""
    since = datetime.now(UTC) - timedelta(days=HISTORY_DAYS)
    rows = db.execute(
        select(
            func.date_trunc("day", StockMovement.created_at).label("day"),
            func.coalesce(func.sum(StockMovement.quantity), 0),
        )
        .where(
            StockMovement.org_id == org_id,
            StockMovement.product_id == product_id,
            StockMovement.type == "pick",
            StockMovement.created_at >= since,
        )
        .group_by("day")
    ).all()
    by_day = {row[0].date(): float(row[1]) for row in rows}
    today = datetime.now(UTC).date()
    return [
        by_day.get(today - timedelta(days=offset), 0.0)
        for offset in range(HISTORY_DAYS - 1, -1, -1)
    ]


def _current_stock(db: Session, org_id: int, product_id: int) -> int:
    return int(
        db.scalar(
            select(func.coalesce(func.sum(StockItem.quantity), 0)).where(
                StockItem.product_id == product_id
            )
        )
        or 0
    )


@router.get("/products/{product_id}/forecast", response_model=ProductForecastOut)
def product_forecast(
    product_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProductForecastOut:
    product = get_owned_product(db, user.org_id, product_id)
    series = _daily_outflow(db, user.org_id, product.id)
    forecast = holt_forecast(series, HORIZON_DAYS)
    avg, std = demand_stats(series)
    current = _current_stock(db, user.org_id, product.id)
    today = datetime.now(UTC).date()

    points: list[ForecastPoint] = []
    for offset, qty in enumerate(series):
        day = today - timedelta(days=HISTORY_DAYS - 1 - offset)
        points.append(ForecastPoint(day=day.isoformat(), quantity=qty, kind="actual"))
    for offset, qty in enumerate(forecast):
        day = today + timedelta(days=offset + 1)
        points.append(
            ForecastPoint(day=day.isoformat(), quantity=round(qty, 1), kind="forecast")
        )

    return ProductForecastOut(
        product_id=product.id,
        sku=product.sku,
        name=product.name,
        current_stock=current,
        daily_avg=round(avg, 2),
        daily_std=round(std, 2),
        reorder_point=reorder_point(series),
        days_until_stockout=days_until_stockout(current, forecast),
        series=points,
    )


@router.get("/reports/reorder-suggestions", response_model=list[ReorderSuggestion])
def reorder_suggestions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ReorderSuggestion]:
    """ROP altına düşen (veya düşmek üzere olan) ürünler + önerilen miktar.
    Hedef stok = ROP + 7 günlük ortalama talep (basit order-up-to politikası)."""
    products = db.scalars(select(Product).where(Product.org_id == user.org_id)).all()
    out: list[ReorderSuggestion] = []
    for product in products:
        series = _daily_outflow(db, user.org_id, product.id)
        avg, _ = demand_stats(series)
        if avg <= 0 and product.min_stock_threshold <= 0:
            continue
        rop = max(reorder_point(series), product.min_stock_threshold)
        current = _current_stock(db, user.org_id, product.id)
        if current > rop:
            continue
        target = rop + math.ceil(avg * 7)
        forecast = holt_forecast(series, HORIZON_DAYS)
        out.append(
            ReorderSuggestion(
                product_id=product.id,
                sku=product.sku,
                name=product.name,
                current_stock=current,
                reorder_point=rop,
                days_until_stockout=days_until_stockout(current, forecast),
                suggested_order_qty=max(target - current, 0),
            )
        )
    out.sort(key=lambda r: (r.days_until_stockout is None, r.days_until_stockout or 0))
    return out


@router.get("/reports/kpi", response_model=KpiOut)
def kpi(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> KpiOut:
    now = datetime.now(UTC)
    d30 = now - timedelta(days=30)
    d7 = now - timedelta(days=7)

    def _sum_moves(kind: str, since: datetime) -> int:
        return int(
            db.scalar(
                select(func.coalesce(func.sum(StockMovement.quantity), 0)).where(
                    StockMovement.org_id == user.org_id,
                    StockMovement.type == kind,
                    StockMovement.created_at >= since,
                )
            )
            or 0
        )

    outbound = _sum_moves("pick", d30)
    inbound = _sum_moves("receive", d30)
    moves_7d = int(
        db.scalar(
            select(func.count(StockMovement.id)).where(
                StockMovement.org_id == user.org_id, StockMovement.created_at >= d7
            )
        )
        or 0
    )

    total_stock = int(
        db.scalar(
            select(func.coalesce(func.sum(StockItem.quantity), 0))
            .join(Product, StockItem.product_id == Product.id)
            .where(Product.org_id == user.org_id)
        )
        or 0
    )
    bin_total = int(
        db.scalar(
            select(func.count(StorageLocation.id))
            .join(Warehouse, StorageLocation.warehouse_id == Warehouse.id)
            .where(StorageLocation.type == "bin", Warehouse.org_id == user.org_id)
        )
        or 0
    )
    bins_used = int(
        db.scalar(
            select(func.count(func.distinct(StockItem.location_id))).where(
                StockItem.quantity > 0,
                StockItem.location_id.in_(
                    select(StorageLocation.id).where(StorageLocation.type == "bin")
                ),
                StockItem.product_id.in_(
                    select(Product.id).where(Product.org_id == user.org_id)
                ),
            )
        )
        or 0
    )

    low_alerts = 0
    busiest_sku: str | None = None
    busiest_row = db.execute(
        select(StockMovement.product_id, func.count(StockMovement.id).label("n"))
        .where(StockMovement.org_id == user.org_id, StockMovement.created_at >= d30)
        .group_by(StockMovement.product_id)
        .order_by(func.count(StockMovement.id).desc())
        .limit(1)
    ).first()
    if busiest_row:
        busiest_sku = db.scalar(select(Product.sku).where(Product.id == busiest_row[0]))
    for product in db.scalars(
        select(Product).where(Product.org_id == user.org_id, Product.min_stock_threshold > 0)
    ).all():
        if _current_stock(db, user.org_id, product.id) <= product.min_stock_threshold:
            low_alerts += 1

    open_orders = int(
        db.scalar(
            select(func.count(Order.id)).where(
                Order.org_id == user.org_id, Order.status == "open"
            )
        )
        or 0
    )
    active_shipments = 0
    for s in db.scalars(
        select(Shipment).where(
            Shipment.org_id == user.org_id,
            Shipment.created_at >= now - timedelta(hours=48),
        )
    ).all():
        elapsed = (now - s.depart_at).total_seconds() / 60.0 * s.time_scale
        if 0 <= elapsed < s.total_min:
            active_shipments += 1

    return KpiOut(
        inventory_turnover_30d=round(outbound / max(total_stock, 1), 3),
        outbound_units_30d=outbound,
        inbound_units_30d=inbound,
        movements_per_day_7d=round(moves_7d / 7, 1),
        occupancy_percent=round(bins_used / max(bin_total, 1) * 100, 1),
        active_alert_products=low_alerts,
        open_orders=open_orders,
        active_shipments=active_shipments,
        busiest_product_sku=busiest_sku,
    )
