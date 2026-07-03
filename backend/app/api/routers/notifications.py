from fastapi import APIRouter, Depends
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.pagination import Page, PageParams, page_params, paginate
from app.models import Notification, User
from app.schemas.notification import NotificationOut, UnreadCountOut
from app.services.notification_service import run_low_stock_check

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=Page[NotificationOut])
def list_notifications(
    unread_only: bool = False,
    params: PageParams = Depends(page_params),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Page[NotificationOut]:
    stmt = (
        select(Notification)
        .where(Notification.org_id == user.org_id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
    )
    if unread_only:
        stmt = stmt.where(Notification.read.is_(False))
    items, total = paginate(db, stmt, params)
    return Page(
        items=[NotificationOut.model_validate(n) for n in items],
        total=total,
        page=params.page,
        page_size=params.page_size,
    )


@router.get("/unread-count", response_model=UnreadCountOut)
def unread_count(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> UnreadCountOut:
    count = db.scalar(
        select(func.count()).where(
            Notification.org_id == user.org_id, Notification.read.is_(False)
        )
    )
    return UnreadCountOut(unread=count or 0)


@router.post("/mark-all-read", status_code=204)
def mark_all_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> None:
    db.execute(
        update(Notification)
        .where(Notification.org_id == user.org_id, Notification.read.is_(False))
        .values(read=True)
    )
    db.flush()


@router.post("/{notification_id}/read", status_code=204)
def mark_read(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    db.execute(
        update(Notification)
        .where(Notification.id == notification_id, Notification.org_id == user.org_id)
        .values(read=True)
    )
    db.flush()


@router.post("/run-low-stock-check")
def trigger_low_stock_check(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    """Manual trigger (also used for demos) — same job the scheduler runs."""
    created = run_low_stock_check(db)
    return {"created": created}
