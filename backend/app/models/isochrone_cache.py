from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class IsochroneCache(Base):
    """Cached openrouteservice isochrone polygons — repeated map views must not
    burn the free daily quota (~500 isochrones/day)."""

    __tablename__ = "isochrone_cache"
    __table_args__ = (
        UniqueConstraint("warehouse_id", "minutes", name="uq_isochrone_wh_minutes"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(
        ForeignKey("warehouses.id", ondelete="CASCADE")
    )
    minutes: Mapped[int] = mapped_column(Integer)
    geojson: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
