from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import Region, User
from app.schemas.geo import RegionCreate, RegionOut, RegionUpdate
from app.services import geo
from app.services.scoping import get_owned_region

router = APIRouter(prefix="/regions", tags=["regions"])


def _to_out(region: Region) -> RegionOut:
    return RegionOut(
        id=region.id,
        name=region.name,
        ring=geo.polygon_to_ring(region.polygon) or [],
        created_at=region.created_at,
    )


@router.get("", response_model=list[RegionOut])
def list_regions(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[RegionOut]:
    regions = db.scalars(
        select(Region).where(Region.org_id == user.org_id).order_by(Region.name, Region.id)
    ).all()
    return [_to_out(r) for r in regions]


@router.post("", response_model=RegionOut, status_code=201)
def create_region(
    payload: RegionCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RegionOut:
    region = Region(
        org_id=user.org_id,
        name=payload.name,
        polygon=geo.ring_to_polygon(payload.ring),
    )
    db.add(region)
    db.flush()
    return _to_out(region)


@router.get("/{region_id}", response_model=RegionOut)
def get_region(
    region_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RegionOut:
    return _to_out(get_owned_region(db, user.org_id, region_id))


@router.patch("/{region_id}", response_model=RegionOut)
def update_region(
    region_id: int,
    payload: RegionUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RegionOut:
    region = get_owned_region(db, user.org_id, region_id)
    if payload.name is not None:
        region.name = payload.name
    if payload.ring is not None:
        region.polygon = geo.ring_to_polygon(payload.ring)
    db.flush()
    return _to_out(region)


@router.delete("/{region_id}", status_code=204)
def delete_region(
    region_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    region = get_owned_region(db, user.org_id, region_id)
    db.delete(region)
    db.flush()
