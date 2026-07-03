from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, aliased

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.pagination import Page, PageParams, page_params, paginate
from app.models import Product, StockItem, StockMovement, StorageLocation, User, Warehouse
from app.schemas.stock import (
    AdjustRequest,
    MovementDetailOut,
    PickRequest,
    ProductLocationOut,
    ReceiveRequest,
    StockItemOut,
    TransferRequest,
)
from app.services import stock_service

router = APIRouter(prefix="/stock", tags=["stock"])


@router.post("/receive", response_model=StockItemOut)
def receive(
    payload: ReceiveRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StockItemOut:
    item = stock_service.receive(
        db,
        org_id=user.org_id,
        user_id=user.id,
        product_id=payload.product_id,
        location_id=payload.location_id,
        quantity=payload.quantity,
        note=payload.note,
    )
    return StockItemOut.model_validate(item)


@router.post("/pick", response_model=StockItemOut)
def pick(
    payload: PickRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StockItemOut:
    item = stock_service.pick(
        db,
        org_id=user.org_id,
        user_id=user.id,
        product_id=payload.product_id,
        location_id=payload.location_id,
        quantity=payload.quantity,
        note=payload.note,
    )
    return StockItemOut.model_validate(item)


@router.post("/transfer", response_model=list[StockItemOut])
def transfer(
    payload: TransferRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[StockItemOut]:
    src, dst = stock_service.transfer(
        db,
        org_id=user.org_id,
        user_id=user.id,
        product_id=payload.product_id,
        from_location_id=payload.from_location_id,
        to_location_id=payload.to_location_id,
        quantity=payload.quantity,
        note=payload.note,
    )
    return [StockItemOut.model_validate(src), StockItemOut.model_validate(dst)]


@router.post("/adjust", response_model=StockItemOut)
def adjust(
    payload: AdjustRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StockItemOut:
    item = stock_service.adjust(
        db,
        org_id=user.org_id,
        user_id=user.id,
        product_id=payload.product_id,
        location_id=payload.location_id,
        new_quantity=payload.new_quantity,
        type_=payload.type,
        note=payload.note,
    )
    return StockItemOut.model_validate(item)


@router.get("/movements", response_model=Page[MovementDetailOut])
def list_movements(
    product_id: int | None = None,
    warehouse_id: int | None = None,
    type: str | None = None,
    params: PageParams = Depends(page_params),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Page[MovementDetailOut]:
    from_loc = aliased(StorageLocation)
    to_loc = aliased(StorageLocation)
    stmt = (
        select(StockMovement)
        .where(StockMovement.org_id == user.org_id)
        .order_by(StockMovement.created_at.desc(), StockMovement.id.desc())
    )
    if product_id is not None:
        stmt = stmt.where(StockMovement.product_id == product_id)
    if type is not None:
        stmt = stmt.where(StockMovement.type == type)
    if warehouse_id is not None:
        stmt = (
            stmt.outerjoin(from_loc, StockMovement.from_location_id == from_loc.id)
            .outerjoin(to_loc, StockMovement.to_location_id == to_loc.id)
            .where(
                or_(from_loc.warehouse_id == warehouse_id, to_loc.warehouse_id == warehouse_id)
            )
        )

    movements, total = paginate(db, stmt, params)

    product_ids = {m.product_id for m in movements}
    loc_ids = {m.from_location_id for m in movements if m.from_location_id} | {
        m.to_location_id for m in movements if m.to_location_id
    }
    user_ids = {m.user_id for m in movements}
    products = {
        p.id: p
        for p in db.scalars(select(Product).where(Product.id.in_(product_ids or {0}))).all()
    }
    locations = {
        loc.id: loc
        for loc in db.scalars(
            select(StorageLocation).where(StorageLocation.id.in_(loc_ids or {0}))
        ).all()
    }
    users = {u.id: u for u in db.scalars(select(User).where(User.id.in_(user_ids or {0}))).all()}

    items = []
    for m in movements:
        p = products.get(m.product_id)
        items.append(
            MovementDetailOut(
                id=m.id,
                product_id=m.product_id,
                from_location_id=m.from_location_id,
                to_location_id=m.to_location_id,
                type=m.type,
                quantity=m.quantity,
                user_id=m.user_id,
                note=m.note,
                created_at=m.created_at,
                product_sku=p.sku if p else "?",
                product_name=p.name if p else "?",
                from_code=locations[m.from_location_id].code
                if m.from_location_id in locations
                else None,
                to_code=locations[m.to_location_id].code
                if m.to_location_id in locations
                else None,
                user_email=users[m.user_id].email if m.user_id in users else None,
            )
        )
    return Page(items=items, total=total, page=params.page, page_size=params.page_size)


@router.get("/find-product", response_model=list[ProductLocationOut])
def find_product(
    q: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ProductLocationOut]:
    """'Ürün nerede?' search: match by SKU/name/barcode, return bins holding it."""
    pattern = f"%{q.strip()}%"
    rows = db.execute(
        select(
            StockItem.location_id,
            StorageLocation.code,
            Warehouse.id.label("warehouse_id"),
            Warehouse.name.label("warehouse_name"),
            StockItem.quantity,
        )
        .join(Product, StockItem.product_id == Product.id)
        .join(StorageLocation, StockItem.location_id == StorageLocation.id)
        .join(Warehouse, StorageLocation.warehouse_id == Warehouse.id)
        .where(
            Product.org_id == user.org_id,
            StockItem.quantity > 0,
            or_(
                Product.sku.ilike(pattern),
                Product.name.ilike(pattern),
                Product.barcode.ilike(pattern),
            ),
        )
        .order_by(Warehouse.id, StorageLocation.code)
        .limit(200)
    ).all()
    return [
        ProductLocationOut(
            location_id=r.location_id,
            code=r.code,
            warehouse_id=r.warehouse_id,
            warehouse_name=r.warehouse_name,
            quantity=r.quantity,
        )
        for r in rows
    ]
