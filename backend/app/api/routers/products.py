from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import ConflictError, ValidationFailedError
from app.core.pagination import Page, PageParams, page_params, paginate
from app.models import Product, User
from app.schemas.product import (
    CsvImportResult,
    ProductCreate,
    ProductOut,
    ProductUpdate,
    ProductWithStockOut,
)
from app.services import csv_io
from app.services.scoping import get_owned_product

router = APIRouter(prefix="/products", tags=["products"])


def _with_stock(product: Product, totals: dict[int, int]) -> ProductWithStockOut:
    total = totals.get(product.id, 0)
    return ProductWithStockOut(
        **ProductOut.model_validate(product).model_dump(),
        total_quantity=total,
        is_low_stock=total < product.min_stock_threshold,
    )


@router.get("", response_model=Page[ProductWithStockOut])
def list_products(
    search: str | None = None,
    low_stock: bool = False,
    params: PageParams = Depends(page_params),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Page[ProductWithStockOut]:
    stmt = select(Product).where(Product.org_id == user.org_id).order_by(Product.sku)
    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Product.sku.ilike(pattern),
                Product.name.ilike(pattern),
                Product.barcode.ilike(pattern),
            )
        )
    totals = csv_io.product_total_quantities(db, user.org_id)

    if low_stock:
        all_products = db.scalars(stmt).all()
        low = [p for p in all_products if totals.get(p.id, 0) < p.min_stock_threshold]
        start = (params.page - 1) * params.page_size
        items = [_with_stock(p, totals) for p in low[start : start + params.page_size]]
        return Page(items=items, total=len(low), page=params.page, page_size=params.page_size)

    products, total = paginate(db, stmt, params)
    return Page(
        items=[_with_stock(p, totals) for p in products],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.post("", response_model=ProductOut, status_code=201)
def create_product(
    payload: ProductCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProductOut:
    existing = db.scalar(
        select(Product).where(Product.org_id == user.org_id, Product.sku == payload.sku)
    )
    if existing is not None:
        raise ConflictError(f"'{payload.sku}' SKU'lu ürün zaten var")
    product = Product(org_id=user.org_id, **payload.model_dump())
    db.add(product)
    db.flush()
    return ProductOut.model_validate(product)


@router.get("/export-csv", response_class=PlainTextResponse)
def export_csv(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> str:
    return csv_io.export_products_csv(db, user.org_id)


@router.post("/import-csv", response_model=CsvImportResult)
def import_csv(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CsvImportResult:
    try:
        content = file.file.read().decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValidationFailedError("CSV dosyası UTF-8 olmalı") from exc
    return csv_io.import_products_csv(db, user.org_id, content)


@router.get("/{product_id}", response_model=ProductWithStockOut)
def get_product(
    product_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProductWithStockOut:
    product = get_owned_product(db, user.org_id, product_id)
    totals = csv_io.product_total_quantities(db, user.org_id)
    return _with_stock(product, totals)


@router.patch("/{product_id}", response_model=ProductOut)
def update_product(
    product_id: int,
    payload: ProductUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProductOut:
    product = get_owned_product(db, user.org_id, product_id)
    updates = payload.model_dump(exclude_unset=True)
    if "sku" in updates and updates["sku"] != product.sku:
        dup = db.scalar(
            select(Product).where(Product.org_id == user.org_id, Product.sku == updates["sku"])
        )
        if dup is not None:
            raise ConflictError(f"'{updates['sku']}' SKU'lu ürün zaten var")
    for field, value in updates.items():
        setattr(product, field, value)
    db.flush()
    return ProductOut.model_validate(product)


@router.delete("/{product_id}", status_code=204)
def delete_product(
    product_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    product = get_owned_product(db, user.org_id, product_id)
    from app.models import StockItem, StockMovement

    has_history = db.scalar(
        select(StockMovement.id).where(StockMovement.product_id == product_id).limit(1)
    ) or db.scalar(select(StockItem.id).where(StockItem.product_id == product_id).limit(1))
    if has_history:
        raise ConflictError("Bu ürünün stok kaydı/hareketi var; önce stok kayıtlarını sıfırlayın")
    db.delete(product)
    db.flush()
