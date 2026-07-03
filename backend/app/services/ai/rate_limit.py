from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import AILimitError
from app.models import AiUsage


def check_and_increment(db: Session, user_id: int) -> None:
    """Atomic per-user daily counter; raises AILimitError past the cap."""
    settings = get_settings()
    today = datetime.now(UTC).date()

    stmt = (
        pg_insert(AiUsage)
        .values(user_id=user_id, day=today, count=1)
        .on_conflict_do_update(
            constraint="uq_ai_usage_user_day",
            set_={"count": AiUsage.count + 1},
        )
    )
    db.execute(stmt)
    db.flush()

    count = db.scalar(
        select(AiUsage.count).where(AiUsage.user_id == user_id, AiUsage.day == today)
    )
    if count is not None and count > settings.ai_daily_limit:
        raise AILimitError(
            f"Günlük AI istek limitine ulaşıldı ({settings.ai_daily_limit}). Yarın tekrar deneyin."
        )
