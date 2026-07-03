"""Stock operations. Single transaction per op, pessimistic row locks, full audit.

Services only flush(); the unit-of-work commit happens at the request boundary
(get_db) so the transactional test fixture can wrap everything in a savepoint.
"""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import InsufficientStockError, ValidationFailedError
from app.models import Product, StockItem, StockMovement, StorageLocation
from app.services.scoping import get_owned_location, get_owned_product


def _locked_item(db: Session, product_id: int, location_id: int) -> StockItem | None:
    return db.scalar(
        select(StockItem)
        .where(StockItem.product_id == product_id, StockItem.location_id == location_id)
        .with_for_update()
    )


def _lock_or_create_item(db: Session, product_id: int, location_id: int) -> StockItem:
    item = _locked_item(db, product_id, location_id)
    if item is not None:
        return item
    try:
        # Savepoint so a lost unique(product_id, location_id) race only rolls
        # back this insert attempt, never the caller's prior work.
        with db.begin_nested():
            item = StockItem(product_id=product_id, location_id=location_id, quantity=0)
            db.add(item)
            db.flush()
    except IntegrityError:
        item = _locked_item(db, product_id, location_id)
        if item is None:  # pragma: no cover - defensive
            raise
    return item


def _movement(
    db: Session,
    *,
    org_id: int,
    user_id: int,
    product: Product,
    type_: str,
    quantity: int,
    from_location_id: int | None = None,
    to_location_id: int | None = None,
    note: str | None = None,
) -> StockMovement:
    movement = StockMovement(
        org_id=org_id,
        product_id=product.id,
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        type=type_,
        quantity=quantity,
        user_id=user_id,
        note=note,
    )
    db.add(movement)
    return movement


def _require_bin(location: StorageLocation) -> None:
    if location.type not in ("bin", "shelf", "rack"):
        raise ValidationFailedError(
            f"Stok yalnızca raf/göz seviyesine işlenebilir ('{location.code}' bir {location.type})"
        )


def receive(
    db: Session,
    *,
    org_id: int,
    user_id: int,
    product_id: int,
    location_id: int,
    quantity: int,
    note: str | None = None,
) -> StockItem:
    product = get_owned_product(db, org_id, product_id)
    location = get_owned_location(db, org_id, location_id)
    _require_bin(location)
    item = _lock_or_create_item(db, product.id, location.id)
    item.quantity += quantity
    _movement(
        db,
        org_id=org_id,
        user_id=user_id,
        product=product,
        type_="receive",
        quantity=quantity,
        to_location_id=location.id,
        note=note,
    )
    db.flush()
    return item


def pick(
    db: Session,
    *,
    org_id: int,
    user_id: int,
    product_id: int,
    location_id: int,
    quantity: int,
    note: str | None = None,
) -> StockItem:
    product = get_owned_product(db, org_id, product_id)
    location = get_owned_location(db, org_id, location_id)
    item = _locked_item(db, product.id, location.id)
    if item is None or item.quantity < quantity:
        available = item.quantity if item else 0
        raise InsufficientStockError(
            f"Yetersiz stok: '{location.code}' gözünde {available} {product.unit} var, "
            f"{quantity} isteniyor"
        )
    item.quantity -= quantity
    _movement(
        db,
        org_id=org_id,
        user_id=user_id,
        product=product,
        type_="pick",
        quantity=quantity,
        from_location_id=location.id,
        note=note,
    )
    db.flush()
    return item


def _after_debit() -> None:
    """Test seam: monkeypatched to raise mid-transfer to prove atomicity."""


def transfer(
    db: Session,
    *,
    org_id: int,
    user_id: int,
    product_id: int,
    from_location_id: int,
    to_location_id: int,
    quantity: int,
    note: str | None = None,
) -> tuple[StockItem, StockItem]:
    if from_location_id == to_location_id:
        raise ValidationFailedError("Kaynak ve hedef göz aynı olamaz")
    product = get_owned_product(db, org_id, product_id)
    source = get_owned_location(db, org_id, from_location_id)
    target = get_owned_location(db, org_id, to_location_id)
    _require_bin(target)

    # Lock in deterministic order to avoid deadlocks between opposing transfers.
    first_id, second_id = sorted((source.id, target.id))
    first = _lock_or_create_item(db, product.id, first_id)
    second = _lock_or_create_item(db, product.id, second_id)
    src_item = first if first.location_id == source.id else second
    dst_item = second if src_item is first else first

    if src_item.quantity < quantity:
        raise InsufficientStockError(
            f"Yetersiz stok: '{source.code}' gözünde {src_item.quantity} {product.unit} var, "
            f"{quantity} isteniyor"
        )
    src_item.quantity -= quantity
    _after_debit()
    dst_item.quantity += quantity
    _movement(
        db,
        org_id=org_id,
        user_id=user_id,
        product=product,
        type_="transfer",
        quantity=quantity,
        from_location_id=source.id,
        to_location_id=target.id,
        note=note,
    )
    db.flush()
    return src_item, dst_item


def adjust(
    db: Session,
    *,
    org_id: int,
    user_id: int,
    product_id: int,
    location_id: int,
    new_quantity: int,
    type_: str = "adjust",
    note: str | None = None,
) -> StockItem:
    if new_quantity < 0:
        raise ValidationFailedError("Stok miktarı negatif olamaz")
    product = get_owned_product(db, org_id, product_id)
    location = get_owned_location(db, org_id, location_id)
    _require_bin(location)
    item = _lock_or_create_item(db, product.id, location.id)
    delta = new_quantity - item.quantity
    item.quantity = new_quantity
    _movement(
        db,
        org_id=org_id,
        user_id=user_id,
        product=product,
        type_=type_,
        quantity=abs(delta),
        from_location_id=location.id if delta < 0 else None,
        to_location_id=location.id if delta >= 0 else None,
        note=note,
    )
    db.flush()
    return item
