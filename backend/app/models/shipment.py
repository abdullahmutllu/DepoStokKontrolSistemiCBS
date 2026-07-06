from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Shipment(Base):
    """Canlı takip edilen sevkiyat turu (VRP çıktısının kalıcı hali).

    Konum saklanmaz: araç pozisyonu her GET'te `services.tracking` ile
    depart_at + geçen süreden deterministik hesaplanır (durumsuz motor).
    `time_scale` demo izlenebilirliği içindir: 30 → 1 gerçek saniye = 30
    simülasyon saniyesi; 1 → gerçek zaman.
    """

    __tablename__ = "shipments"

    id: Mapped[int] = mapped_column(primary_key=True)
    org_id: Mapped[int] = mapped_column(ForeignKey("organizations.id"), index=True)
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    vehicle_name: Mapped[str] = mapped_column(String(50))
    # Durak anlık görüntüsü: [{customer_id,name,lat,lng,demand,service_min}]
    stops: Mapped[list] = mapped_column(JSON)
    base_speed_kmh: Mapped[float] = mapped_column(Float, default=65.0)
    time_scale: Mapped[float] = mapped_column(Float, default=30.0)
    total_km: Mapped[float] = mapped_column(Float)
    total_min: Mapped[float] = mapped_column(Float)
    # loop=True: demo aracı — plan bitince başa sarar, sürekli hareket eder.
    loop: Mapped[bool] = mapped_column(Boolean, default=False)
    depart_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
