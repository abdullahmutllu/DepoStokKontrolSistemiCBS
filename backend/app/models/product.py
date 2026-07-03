from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (UniqueConstraint("org_id", "sku", name="uq_products_org_sku"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    sku: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(String(2000))
    unit: Mapped[str] = mapped_column(String(20), default="adet")
    barcode: Mapped[str | None] = mapped_column(String(64))
    dim_w: Mapped[float | None] = mapped_column(Float)
    dim_d: Mapped[float | None] = mapped_column(Float)
    dim_h: Mapped[float | None] = mapped_column(Float)
    min_stock_threshold: Mapped[int] = mapped_column(Integer, default=0)
    image_url: Mapped[str | None] = mapped_column(String(1000))
    meta: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
