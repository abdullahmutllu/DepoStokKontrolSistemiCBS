from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models import User
from app.schemas.report import (
    LowStockRow,
    MovementHistoryPoint,
    MoverRow,
    OccupancyRow,
    StockByLocationRow,
    WarehouseSummaryOut,
)
from app.services import csv_io, report_service
from app.services.scoping import get_owned_warehouse

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/warehouse-summaries", response_model=list[WarehouseSummaryOut])
def warehouse_summaries(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[WarehouseSummaryOut]:
    return report_service.warehouse_summaries(db, user.org_id)


@router.get("/stock-by-location", response_model=list[StockByLocationRow])
def stock_by_location(
    warehouse_id: int,
    group_type: str = Query("zone", pattern="^(zone|aisle|rack)$"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[StockByLocationRow]:
    get_owned_warehouse(db, user.org_id, warehouse_id)
    return report_service.stock_by_location(db, user.org_id, warehouse_id, group_type)


@router.get("/occupancy", response_model=list[OccupancyRow])
def occupancy(
    warehouse_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[OccupancyRow]:
    get_owned_warehouse(db, user.org_id, warehouse_id)
    return report_service.occupancy(db, user.org_id, warehouse_id)


@router.get("/low-stock", response_model=list[LowStockRow])
def low_stock(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[LowStockRow]:
    return report_service.low_stock(db, user.org_id)


@router.get("/top-movers", response_model=list[MoverRow])
def top_movers(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=50),
    ascending: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[MoverRow]:
    return report_service.top_movers(db, user.org_id, days=days, limit=limit, ascending=ascending)


@router.get("/movement-history", response_model=list[MovementHistoryPoint])
def movement_history(
    days: int = Query(14, ge=1, le=365),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[MovementHistoryPoint]:
    return report_service.movement_history(db, user.org_id, days=days)


@router.get("/stock-export-csv", response_class=PlainTextResponse)
def stock_export_csv(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> str:
    return csv_io.export_stock_csv(db, user.org_id)
