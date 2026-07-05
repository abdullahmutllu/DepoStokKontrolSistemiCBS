from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Customer(Base):
    """Demand point for network analysis: a customer/dealer location whose
    weight approximates order volume. Feeds heatmaps, center-of-gravity and
    closest-facility analyses on the map workspace."""

    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    location = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    weight: Mapped[int] = mapped_column(Integer, default=1)  # talep ağırlığı
    city: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
