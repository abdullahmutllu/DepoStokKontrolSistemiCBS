from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Region(Base):
    """Named, org-scoped analysis polygon drawn on the map workspace."""

    __tablename__ = "regions"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    polygon = mapped_column(Geography(geometry_type="POLYGON", srid=4326), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
