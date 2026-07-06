from typing import Any

from sqlalchemy import Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Level(Base):
    """A building storey inside a warehouse (IMDF 'level'): ground, mezzanine…

    A warehouse has one or more levels; each storage_location belongs to exactly
    one level. `ordinal` is the vertical order (0 = ground floor, 1 = mezzanine).
    `outline` (optional) is the level footprint as a local-frame ring stored in
    meta; the geographic projection is derived on the client via georef.
    """

    __tablename__ = "levels"
    __table_args__ = (
        UniqueConstraint("warehouse_id", "ordinal", name="uq_levels_warehouse_ordinal"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    warehouse_id: Mapped[int] = mapped_column(
        ForeignKey("warehouses.id", ondelete="CASCADE"), index=True
    )
    ordinal: Mapped[int] = mapped_column(Integer, default=0)  # 0 = zemin, 1 = asma kat
    name: Mapped[str] = mapped_column(String(80), default="Zemin")
    base_elevation_m: Mapped[float] = mapped_column(Float, default=0.0)  # kat taban yüksekliği
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
