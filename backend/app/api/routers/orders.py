"""Siparişler ve dalga toplama (wave picking): birden çok siparişin
kalemleri ürün bazında birleştirilir, gözlere çözülür ve mevcut rota
çözücüyle (S-shape / largest-gap / 2-opt) tek toplama rotasına bağlanır."""

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import ValidationFailedError
from app.models import Order, OrderLine, Product, StockItem, StorageLocation, User
from app.schemas.logistics import (
    OrderCreate,
    OrderLineOut,
    OrderOut,
    WaveLine,
    WavePickOut,
    WavePickRequest,
)
from app.schemas.network import PickItem
from app.services.picking import pick_route
from app.services.scoping import get_owned_product, get_owned_warehouse

router = APIRouter(tags=["orders"])


def _order_out(order: Order, products: dict[int, Product]) -> OrderOut:
    return OrderOut(
        id=order.id,
        code=order.code,
        warehouse_id=order.warehouse_id,
        customer_name=order.customer_name,
        status=order.status,
        created_at=order.created_at,
        lines=[
            OrderLineOut(
                product_id=line.product_id,
                sku=products[line.product_id].sku,
                product_name=products[line.product_id].name,
                quantity=line.quantity,
            )
            for line in order.lines
        ],
    )


def _products_of(db: Session, org_id: int) -> dict[int, Product]:
    return {
        p.id: p
        for p in db.scalars(select(Product).where(Product.org_id == org_id)).all()
    }


@router.get("/orders", response_model=list[OrderOut])
def list_orders(
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[OrderOut]:
    stmt = (
        select(Order)
        .options(selectinload(Order.lines))
        .where(Order.org_id == user.org_id)
        .order_by(Order.id.desc())
    )
    if status:
        stmt = stmt.where(Order.status == status)
    products = _products_of(db, user.org_id)
    return [_order_out(o, products) for o in db.scalars(stmt).unique().all()]


@router.post("/orders", response_model=OrderOut, status_code=201)
def create_order(
    payload: OrderCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OrderOut:
    warehouse = get_owned_warehouse(db, user.org_id, payload.warehouse_id)
    for line in payload.lines:
        get_owned_product(db, user.org_id, line.product_id)

    order = Order(
        org_id=user.org_id,
        warehouse_id=warehouse.id,
        code="",
        customer_name=payload.customer_name,
    )
    db.add(order)
    db.flush()
    order.code = f"SIP-{order.id:04d}"
    for line in payload.lines:
        db.add(OrderLine(order_id=order.id, product_id=line.product_id, quantity=line.quantity))
    db.commit()
    db.refresh(order)
    return _order_out(order, _products_of(db, user.org_id))


@router.post("/orders/wave-pick", response_model=WavePickOut)
def wave_pick(
    payload: WavePickRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> WavePickOut:
    orders = list(
        db.scalars(
            select(Order)
            .options(selectinload(Order.lines))
            .where(Order.id.in_(payload.order_ids), Order.org_id == user.org_id)
        )
        .unique()
        .all()
    )
    if len(orders) != len(set(payload.order_ids)):
        raise ValidationFailedError("Sipariş(ler) bulunamadı.")
    warehouse_ids = {o.warehouse_id for o in orders}
    if len(warehouse_ids) != 1:
        raise ValidationFailedError("Dalga toplama tek depodaki siparişlerle yapılır.")
    warehouse_id = warehouse_ids.pop()

    # Ürün bazında birleştir
    totals: dict[int, int] = {}
    for order in orders:
        for line in order.lines:
            totals[line.product_id] = totals.get(line.product_id, 0) + line.quantity

    products = _products_of(db, user.org_id)
    lines: list[WaveLine] = []
    resolvable: list[PickItem] = []
    for product_id, qty in sorted(totals.items()):
        # en dolu göz (bu depoda)
        row = db.execute(
            select(StockItem.location_id, StockItem.quantity, StorageLocation.code)
            .join(StorageLocation, StockItem.location_id == StorageLocation.id)
            .where(
                StockItem.product_id == product_id,
                StockItem.quantity > 0,
                StorageLocation.warehouse_id == warehouse_id,
                StorageLocation.type == "bin",
            )
            .order_by(StockItem.quantity.desc())
            .limit(1)
        ).first()
        lines.append(
            WaveLine(
                product_id=product_id,
                sku=products[product_id].sku,
                product_name=products[product_id].name,
                total_quantity=qty,
                location_id=row[0] if row else None,
                location_code=row[2] if row else None,
            )
        )
        if row:
            resolvable.append(PickItem(product_id=product_id, quantity=qty))

    route = None
    if len(resolvable) >= 2:
        route = pick_route(db, user.org_id, warehouse_id, resolvable, None)

    for order in orders:
        order.status = "waved"
    db.commit()

    return WavePickOut(
        order_ids=payload.order_ids,
        warehouse_id=warehouse_id,
        lines=lines,
        route=route,
    )


@router.post("/orders/{order_id}/picked", response_model=OrderOut)
def mark_picked(
    order_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> OrderOut:
    order = db.scalar(
        select(Order)
        .options(selectinload(Order.lines))
        .where(Order.id == order_id, Order.org_id == user.org_id)
    )
    if order is None:
        raise ValidationFailedError("Sipariş bulunamadı.")
    order.status = "picked"
    db.commit()
    return _order_out(order, _products_of(db, user.org_id))


@router.get("/orders/count", response_model=dict)
def order_counts(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    rows = db.execute(
        select(Order.status, func.count(Order.id))
        .where(Order.org_id == user.org_id)
        .group_by(Order.status)
    ).all()
    return {status: count for status, count in rows}
