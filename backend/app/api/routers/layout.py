from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.errors import NotFoundError
from app.models import StorageLocation, User
from app.schemas.location import LayoutGenerateRequest, LayoutGenerateResult
from app.services import layout_builder
from app.services.scoping import get_owned_warehouse

router = APIRouter(tags=["layout"])


@router.post(
    "/warehouses/{warehouse_id}/layout/generate",
    response_model=LayoutGenerateResult,
    status_code=201,
)
def generate(
    warehouse_id: int,
    payload: LayoutGenerateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LayoutGenerateResult:
    return layout_builder.generate_layout(db, user.org_id, warehouse_id, payload)


@router.delete("/warehouses/{warehouse_id}/zones/{zone_id}", status_code=204)
def delete_zone(
    warehouse_id: int,
    zone_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Remove a zone and its whole subtree (FK ondelete=CASCADE)."""
    warehouse = get_owned_warehouse(db, user.org_id, warehouse_id)
    zone = db.scalar(
        select(StorageLocation).where(
            StorageLocation.id == zone_id,
            StorageLocation.warehouse_id == warehouse.id,
            StorageLocation.type == "zone",
        )
    )
    if zone is None:
        raise NotFoundError("Zon bulunamadı")
    db.delete(zone)
    db.flush()
