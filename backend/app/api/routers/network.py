from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import User
from app.schemas.network import (
    CenterOfGravityOut,
    ClosestFacilityOut,
    CoverageOut,
    DemandPoint,
    FlowMapOut,
)
from app.services import network_analysis

router = APIRouter(prefix="/network", tags=["network"])


@router.get("/demand-points", response_model=list[DemandPoint])
def demand_points(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[DemandPoint]:
    return network_analysis.demand_points(db, user.org_id)


class CogRequest(BaseModel):
    n_sites: int = Field(default=1, ge=1, le=3)


@router.post("/center-of-gravity", response_model=CenterOfGravityOut)
def center_of_gravity(
    payload: CogRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CenterOfGravityOut:
    """Greenfield analysis: demand-weighted optimal site suggestion(s)."""
    return network_analysis.center_of_gravity(db, user.org_id, payload.n_sites)


@router.get("/closest-facility", response_model=ClosestFacilityOut)
def closest_facility(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> ClosestFacilityOut:
    return network_analysis.closest_facility(db, user.org_id)


@router.get("/coverage", response_model=CoverageOut)
def coverage(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> CoverageOut:
    return network_analysis.coverage(db, user.org_id)


@router.get("/flow-map", response_model=FlowMapOut)
def flow_map(
    day: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FlowMapOut:
    return network_analysis.flow_map(db, user.org_id, day=day)
