from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import User
from app.schemas.ai import (
    AskRequest,
    AskResponse,
    SlottingRequest,
    SlottingResponse,
    SummaryResponse,
)
from app.services.ai import rate_limit, slotting, summarize, text_to_query

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/ask", response_model=AskResponse)
def ask(
    payload: AskRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AskResponse:
    rate_limit.check_and_increment(db, user.id)
    return text_to_query.answer_question(db, user.org_id, payload.question)


@router.post("/slotting", response_model=SlottingResponse)
def slotting_suggestion(
    payload: SlottingRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SlottingResponse:
    rate_limit.check_and_increment(db, user.id)
    return slotting.suggest_slots(db, user.org_id, payload.product_id, payload.warehouse_id)


@router.get("/summary", response_model=SummaryResponse)
def summary(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SummaryResponse:
    rate_limit.check_and_increment(db, user.id)
    return summarize.weekly_summary(db, user.org_id)
