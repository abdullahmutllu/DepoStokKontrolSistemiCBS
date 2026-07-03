from typing import Any

from sqlalchemy import Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class StorageLocation(Base):
    """Node in the in-warehouse hierarchy: zone > aisle > rack > shelf > bin.

    Positions/dimensions are meters in the warehouse-local cartesian frame
    (origin at warehouse corner), NOT geographic coordinates.
    """

    __tablename__ = "storage_locations"
    __table_args__ = (
        UniqueConstraint("warehouse_id", "code", name="uq_storage_locations_warehouse_code"),
        Index("ix_storage_locations_warehouse_parent", "warehouse_id", "parent_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("storage_locations.id", ondelete="CASCADE")
    )
    type: Mapped[str] = mapped_column(String(10))  # zone | aisle | rack | shelf | bin
    code: Mapped[str] = mapped_column(String(50))
    label: Mapped[str | None] = mapped_column(String(200))
    pos_x: Mapped[float] = mapped_column(Float, default=0.0)
    pos_y: Mapped[float] = mapped_column(Float, default=0.0)
    pos_z: Mapped[float] = mapped_column(Float, default=0.0)
    dim_w: Mapped[float] = mapped_column(Float, default=1.0)
    dim_d: Mapped[float] = mapped_column(Float, default=1.0)
    dim_h: Mapped[float] = mapped_column(Float, default=1.0)
    rotation: Mapped[float] = mapped_column(Float, default=0.0)  # degrees around z
    capacity: Mapped[int | None] = mapped_column(Integer)
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
