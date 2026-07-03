from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import User
from app.schemas.geo import RegionAnalysisOut, RegionRing
from app.services import geo_analysis

router = APIRouter(prefix="/geo", tags=["geo"])


@router.post("/region-analysis", response_model=RegionAnalysisOut)
def region_analysis(
    payload: RegionRing,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> RegionAnalysisOut:
    """Analyze the caller's warehouses inside a drawn polygon. Saved regions
    reuse this endpoint from the client — single code path."""
    return geo_analysis.region_analysis(db, user.org_id, payload)
