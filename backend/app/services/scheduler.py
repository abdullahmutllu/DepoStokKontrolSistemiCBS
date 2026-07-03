import logging

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import get_settings
from app.core.database import SessionLocal

logger = logging.getLogger("depo.scheduler")


def _low_stock_job() -> None:
    from app.services.notification_service import run_low_stock_check

    db = SessionLocal()
    try:
        created = run_low_stock_check(db)
        db.commit()
        if created:
            logger.info("Low-stock check created %d notification(s)", created)
    except Exception:
        db.rollback()
        logger.exception("Low-stock check failed")
    finally:
        db.close()


def build_scheduler() -> BackgroundScheduler:
    settings = get_settings()
    scheduler = BackgroundScheduler(daemon=True)
    scheduler.add_job(
        _low_stock_job,
        "interval",
        minutes=settings.low_stock_check_minutes,
        id="low_stock_check",
        max_instances=1,
        coalesce=True,
    )
    return scheduler
