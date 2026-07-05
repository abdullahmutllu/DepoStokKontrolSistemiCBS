from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import User
from app.schemas.network import PickRouteOut, PickRouteRequest
from app.services import picking

router = APIRouter(tags=["picking"])


@router.post("/warehouses/{warehouse_id}/pick-route", response_model=PickRouteOut)
def pick_route(
    warehouse_id: int,
    payload: PickRouteRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> PickRouteOut:
    """Order-picking route comparison: S-shape (industry baseline),
    largest-gap and 2-opt-optimized policies with meters walked.
    Analysis only — writes no movements."""
    return picking.pick_route(
        db, user.org_id, warehouse_id, payload.items, payload.location_ids
    )
