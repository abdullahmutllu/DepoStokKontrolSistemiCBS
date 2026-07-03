"""Low-stock detection → in-app notification rows + email to org owners."""

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Notification, Organization, User
from app.services import report_service
from app.services.emailer import send_email

logger = logging.getLogger("depo.notifications")


def run_low_stock_check(db: Session) -> int:
    """Scan every org; create one unread notification per low-stock product.

    Dedupes against existing unread low_stock notifications so repeated runs
    don't spam. Returns the number of notifications created.
    """
    created = 0
    org_ids = db.scalars(select(Organization.id)).all()
    for org_id in org_ids:
        rows = report_service.low_stock(db, org_id)
        if not rows:
            continue
        unread_product_ids = set(
            db.scalars(
                select(Notification.product_id).where(
                    Notification.org_id == org_id,
                    Notification.type == "low_stock",
                    Notification.read.is_(False),
                )
            ).all()
        )
        fresh = [r for r in rows if r.product_id not in unread_product_ids]
        if not fresh:
            continue

        for row in fresh:
            db.add(
                Notification(
                    org_id=org_id,
                    type="low_stock",
                    title=f"Düşük stok: {row.sku}",
                    message=(
                        f"{row.name} toplam stoğu {row.total_quantity} {row.unit} — "
                        f"minimum eşik {row.min_stock_threshold} {row.unit} altına düştü."
                    ),
                    product_id=row.product_id,
                )
            )
            created += 1

        owners = db.scalars(
            select(User).where(User.org_id == org_id, User.role == "owner")
        ).all()
        lines = [
            f"- {r.sku} · {r.name}: {r.total_quantity}/{r.min_stock_threshold} {r.unit}"
            for r in fresh
        ]
        body = "Aşağıdaki ürünler minimum stok eşiğinin altında:\n\n" + "\n".join(lines)
        for owner in owners:
            send_email(owner.email, f"Düşük stok uyarısı ({len(fresh)} ürün)", body)

    db.flush()
    return created
