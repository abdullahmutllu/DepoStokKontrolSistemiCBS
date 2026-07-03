import csv
import io

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Product, StockItem, StorageLocation, Warehouse
from app.schemas.product import CsvImportResult, ProductCreate

PRODUCT_COLUMNS = [
    "sku",
    "name",
    "description",
    "unit",
    "barcode",
    "dim_w",
    "dim_d",
    "dim_h",
    "min_stock_threshold",
]


def export_products_csv(db: Session, org_id: int) -> str:
    products = db.scalars(
        select(Product).where(Product.org_id == org_id).order_by(Product.sku)
    ).all()
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=PRODUCT_COLUMNS)
    writer.writeheader()
    for p in products:
        writer.writerow(
            {
                "sku": p.sku,
                "name": p.name,
                "description": p.description or "",
                "unit": p.unit,
                "barcode": p.barcode or "",
                "dim_w": p.dim_w if p.dim_w is not None else "",
                "dim_d": p.dim_d if p.dim_d is not None else "",
                "dim_h": p.dim_h if p.dim_h is not None else "",
                "min_stock_threshold": p.min_stock_threshold,
            }
        )
    return buf.getvalue()


def export_stock_csv(db: Session, org_id: int) -> str:
    rows = db.execute(
        select(
            Product.sku,
            Product.name,
            Warehouse.name.label("warehouse"),
            StorageLocation.code,
            StockItem.quantity,
        )
        .join(Product, StockItem.product_id == Product.id)
        .join(StorageLocation, StockItem.location_id == StorageLocation.id)
        .join(Warehouse, StorageLocation.warehouse_id == Warehouse.id)
        .where(Product.org_id == org_id, StockItem.quantity > 0)
        .order_by(Product.sku, StorageLocation.code)
    ).all()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["sku", "product_name", "warehouse", "location_code", "quantity"])
    for r in rows:
        writer.writerow([r.sku, r.name, r.warehouse, r.code, r.quantity])
    return buf.getvalue()


def import_products_csv(db: Session, org_id: int, content: str) -> CsvImportResult:
    """Upsert products by SKU. Row errors are collected, valid rows still apply."""
    reader = csv.DictReader(io.StringIO(content))
    headers = reader.fieldnames or []
    if "sku" not in headers or "name" not in headers:
        return CsvImportResult(
            created=0, updated=0, errors=["CSV başlıkları eksik: en az 'sku' ve 'name' gerekli"]
        )

    existing = {
        p.sku: p
        for p in db.scalars(select(Product).where(Product.org_id == org_id)).all()
    }
    created = updated = 0
    errors: list[str] = []
    seen: set[str] = set()

    for line_no, row in enumerate(reader, start=2):
        sku = (row.get("sku") or "").strip()
        if not sku:
            errors.append(f"Satır {line_no}: sku boş")
            continue
        if sku in seen:
            errors.append(f"Satır {line_no}: '{sku}' dosyada birden fazla kez geçiyor")
            continue
        seen.add(sku)
        try:
            data = ProductCreate(
                sku=sku,
                name=(row.get("name") or "").strip(),
                description=(row.get("description") or "").strip() or None,
                unit=(row.get("unit") or "adet").strip() or "adet",
                barcode=(row.get("barcode") or "").strip() or None,
                dim_w=float(row["dim_w"]) if (row.get("dim_w") or "").strip() else None,
                dim_d=float(row["dim_d"]) if (row.get("dim_d") or "").strip() else None,
                dim_h=float(row["dim_h"]) if (row.get("dim_h") or "").strip() else None,
                min_stock_threshold=int(row["min_stock_threshold"])
                if (row.get("min_stock_threshold") or "").strip()
                else 0,
            )
        except (ValueError, TypeError) as exc:
            errors.append(f"Satır {line_no}: geçersiz değer ({exc})")
            continue
        except Exception as exc:  # pydantic ValidationError
            errors.append(f"Satır {line_no}: {exc}")
            continue

        if sku in existing:
            p = existing[sku]
            for field, value in data.model_dump(exclude={"sku"}).items():
                setattr(p, field, value)
            updated += 1
        else:
            db.add(Product(org_id=org_id, **data.model_dump()))
            created += 1

    db.flush()
    return CsvImportResult(created=created, updated=updated, errors=errors)


def product_total_quantities(db: Session, org_id: int) -> dict[int, int]:
    rows = db.execute(
        select(StockItem.product_id, func.coalesce(func.sum(StockItem.quantity), 0))
        .join(Product, StockItem.product_id == Product.id)
        .where(Product.org_id == org_id)
        .group_by(StockItem.product_id)
    ).all()
    return {pid: total for pid, total in rows}
