from datetime import datetime

from geoalchemy2 import Geography
from sqlalchemy import DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Warehouse(Base):
    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(500))
    location = mapped_column(Geography(geometry_type="POINT", srid=4326), nullable=False)
    footprint = mapped_column(Geography(geometry_type="POLYGON", srid=4326), nullable=True)
    local_width: Mapped[float] = mapped_column(Float, default=50.0)  # meters (x axis)
    local_depth: Mapped[float] = mapped_column(Float, default=30.0)  # meters (y axis)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
