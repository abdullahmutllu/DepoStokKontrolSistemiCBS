import csv
import io

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import ValidationFailedError
from app.models import Customer, User
from app.schemas.network import CustomerCreate, CustomerOut, CustomerUpdate
from app.schemas.product import CsvImportResult
from app.schemas.warehouse import LatLng
from app.services import geo
from app.services.scoping import get_owned_customer

router = APIRouter(prefix="/customers", tags=["customers"])


def _to_out(c: Customer) -> CustomerOut:
    return CustomerOut(
        id=c.id,
        name=c.name,
        location=geo.point_to_latlng(c.location),
        weight=c.weight,
        city=c.city,
        created_at=c.created_at,
    )


@router.get("", response_model=list[CustomerOut])
def list_customers(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[CustomerOut]:
    customers = db.scalars(
        select(Customer).where(Customer.org_id == user.org_id).order_by(Customer.name)
    ).all()
    return [_to_out(c) for c in customers]


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(
    payload: CustomerCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CustomerOut:
    customer = Customer(
        org_id=user.org_id,
        name=payload.name,
        location=geo.latlng_to_point(payload.location),
        weight=payload.weight,
        city=payload.city,
    )
    db.add(customer)
    db.flush()
    return _to_out(customer)


@router.patch("/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: int,
    payload: CustomerUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CustomerOut:
    customer = get_owned_customer(db, user.org_id, customer_id)
    if payload.name is not None:
        customer.name = payload.name
    if payload.weight is not None:
        customer.weight = payload.weight
    if payload.city is not None:
        customer.city = payload.city
    if payload.location is not None:
        customer.location = geo.latlng_to_point(payload.location)
    db.flush()
    return _to_out(customer)


@router.delete("/{customer_id}", status_code=204)
def delete_customer(
    customer_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    customer = get_owned_customer(db, user.org_id, customer_id)
    db.delete(customer)
    db.flush()


@router.post("/import-csv", response_model=CsvImportResult)
def import_csv(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CsvImportResult:
    """Columns: name, lat, lng, weight (optional), city (optional).
    Upserts by name within the org; bad rows are collected, good rows apply."""
    try:
        content = file.file.read().decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValidationFailedError("CSV dosyası UTF-8 olmalı") from exc

    reader = csv.DictReader(io.StringIO(content))
    headers = reader.fieldnames or []
    if not {"name", "lat", "lng"}.issubset(set(headers)):
        return CsvImportResult(
            created=0, updated=0, errors=["CSV başlıkları eksik: name, lat, lng gerekli"]
        )

    existing = {
        c.name: c
        for c in db.scalars(select(Customer).where(Customer.org_id == user.org_id)).all()
    }
    created = updated = 0
    errors: list[str] = []
    for line_no, row in enumerate(reader, start=2):
        name = (row.get("name") or "").strip()
        if not name:
            errors.append(f"Satır {line_no}: name boş")
            continue
        try:
            loc = LatLng(lat=float(row["lat"]), lng=float(row["lng"]))
            weight = int(row["weight"]) if (row.get("weight") or "").strip() else 1
            weight = max(1, min(1000, weight))
        except (ValueError, TypeError) as exc:
            errors.append(f"Satır {line_no}: geçersiz değer ({exc})")
            continue
        city = (row.get("city") or "").strip() or None

        if name in existing:
            c = existing[name]
            c.location = geo.latlng_to_point(loc)
            c.weight = weight
            c.city = city
            updated += 1
        else:
            db.add(
                Customer(
                    org_id=user.org_id,
                    name=name,
                    location=geo.latlng_to_point(loc),
                    weight=weight,
                    city=city,
                )
            )
            created += 1

    db.flush()
    return CsvImportResult(created=created, updated=updated, errors=errors)
