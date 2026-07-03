"""Org-anchored lookups. Every cross-org access fails as 404 (no existence leak)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import NotFoundError
from app.models import Product, Region, StorageLocation, Warehouse


def get_owned_warehouse(db: Session, org_id: int, warehouse_id: int) -> Warehouse:
    wh = db.scalar(
        select(Warehouse).where(Warehouse.id == warehouse_id, Warehouse.org_id == org_id)
    )
    if wh is None:
        raise NotFoundError("Depo bulunamadı")
    return wh


def get_owned_product(db: Session, org_id: int, product_id: int) -> Product:
    product = db.scalar(
        select(Product).where(Product.id == product_id, Product.org_id == org_id)
    )
    if product is None:
        raise NotFoundError("Ürün bulunamadı")
    return product


def get_owned_region(db: Session, org_id: int, region_id: int) -> Region:
    region = db.scalar(
        select(Region).where(Region.id == region_id, Region.org_id == org_id)
    )
    if region is None:
        raise NotFoundError("Bölge bulunamadı")
    return region


def get_owned_location(db: Session, org_id: int, location_id: int) -> StorageLocation:
    loc = db.scalar(
        select(StorageLocation)
        .join(Warehouse, StorageLocation.warehouse_id == Warehouse.id)
        .where(StorageLocation.id == location_id, Warehouse.org_id == org_id)
    )
    if loc is None:
        raise NotFoundError("Lokasyon bulunamadı")
    return loc
